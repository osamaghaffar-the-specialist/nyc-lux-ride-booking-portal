import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response(
      { ok: false, error: "Method not allowed." },
      405,
    );
  }

  try {
    let body: any;

    try {
      body = await req.json();
    } catch {
      return response(
        { ok: false, error: "Invalid request." },
        400,
      );
    }

    const token = String(body?.token || "").trim();
    const gratuityPercentage = Number(body?.gratuity_percentage);

    if (!uuidRegex.test(token)) {
      return response(
        { ok: false, error: "Invalid quote link." },
        400,
      );
    }

    const allowedPercentages = [0, 10, 15, 20];

    if (!allowedPercentages.includes(gratuityPercentage)) {
      return response(
        { ok: false, error: "Invalid gratuity selection." },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase server environment variables.");

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    // --------------------------------------------------
    // Find quote by secure public token
    // --------------------------------------------------

    const {
      data: quote,
      error: quoteError,
    } = await supabase
      .from("quotes")
      .select(`
        id,
        booking_id,
        version,
        status,
        total_amount,
        gratuity,
        valid_until,
        accepted_at
      `)
      .eq("public_token", token)
      .maybeSingle();

    if (quoteError) {
      console.error("Accept quote lookup error:", quoteError);

      return response(
        { ok: false, error: "Quote could not be loaded." },
        500,
      );
    }

    if (!quote) {
      return response(
        { ok: false, error: "Quote not found." },
        404,
      );
    }

    // --------------------------------------------------
    // Load booking
    // --------------------------------------------------

    const {
      data: booking,
      error: bookingError,
    } = await supabase
      .from("bookings")
      .select("id, status")
      .eq("id", quote.booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Accept quote booking lookup error:", bookingError);

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    // --------------------------------------------------
    // Confirm this token belongs to latest quote version
    // --------------------------------------------------

    const {
      data: latestQuote,
      error: latestQuoteError,
    } = await supabase
      .from("quotes")
      .select("id, version")
      .eq("booking_id", quote.booking_id)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    if (latestQuoteError || !latestQuote) {
      console.error("Latest quote lookup error:", latestQuoteError);

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    if (latestQuote.id !== quote.id) {
      return response(
        {
          ok: false,
          error: "A newer quote is available. Please use the latest quote link.",
        },
        409,
      );
    }

    // --------------------------------------------------
    // Already accepted = idempotent success
    // --------------------------------------------------

    if (
      quote.status === "accepted" ||
      booking.status === "awaiting_payment" ||
      booking.status === "paid" ||
      booking.status === "confirmed"
    ) {
      return response({
        ok: true,
        already_accepted: true,
        status: "accepted",
        booking_status: booking.status,
        gratuity: Number(quote.gratuity || 0),
        final_total: Number(quote.total_amount || 0),
        currency: "USD",
        accepted_at: quote.accepted_at,
      });
    }

    // --------------------------------------------------
    // Block invalid booking states
    // --------------------------------------------------

    if (
      ["cancelled", "declined", "completed"].includes(booking.status)
    ) {
      return response(
        {
          ok: false,
          error: "This booking can no longer accept this quote.",
        },
        409,
      );
    }

    // --------------------------------------------------
    // Expiration
    // --------------------------------------------------

    if (
      quote.valid_until &&
      new Date(quote.valid_until).getTime() < Date.now()
    ) {
      return response(
        {
          ok: false,
          expired: true,
          error: "This quote has expired.",
        },
        410,
      );
    }

    // --------------------------------------------------
    // Read authoritative quote line items
    // --------------------------------------------------

    const {
      data: lineItems,
      error: lineItemsError,
    } = await supabase
      .from("quote_line_items")
      .select(`
        id,
        pricing_rule_id,
        code,
        label,
        quantity,
        rate,
        percentage,
        amount,
        customer_visible,
        source,
        sort_order
      `)
      .eq("quote_id", quote.id);

    if (lineItemsError) {
      console.error("Accept quote line item lookup error:", lineItemsError);

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    const items = lineItems || [];

    // --------------------------------------------------
    // Load pricing-rule gratuity eligibility
    // --------------------------------------------------

    const ruleIds = [
      ...new Set(
        items
          .map((item: any) => item.pricing_rule_id)
          .filter(Boolean),
      ),
    ];

    const ruleMap = new Map<string, any>();

    if (ruleIds.length > 0) {
      const {
        data: rules,
        error: rulesError,
      } = await supabase
        .from("pricing_rules")
        .select("id, code, gratuity_eligible")
        .in("id", ruleIds);

      if (rulesError) {
        console.error("Pricing-rule lookup error:", rulesError);

        return response(
          { ok: false, error: "Quote could not be accepted." },
          500,
        );
      }

      for (const rule of rules || []) {
        ruleMap.set(rule.id, rule);
      }
    }

    // --------------------------------------------------
    // Existing subtotal excludes gratuity itself
    // --------------------------------------------------

    const nonGratuityItems = items.filter(
      (item: any) => item.code !== "gratuity",
    );

    const subtotal = roundMoney(
      nonGratuityItems.reduce(
        (sum: number, item: any) =>
          sum + Number(item.amount || 0),
        0,
      ),
    );

    // --------------------------------------------------
    // Server-authoritative gratuity base
    // --------------------------------------------------

    const gratuityBase = roundMoney(
      nonGratuityItems.reduce(
        (sum: number, item: any) => {
          const rule = item.pricing_rule_id
            ? ruleMap.get(item.pricing_rule_id)
            : null;

          if (rule?.gratuity_eligible === true) {
            return sum + Number(item.amount || 0);
          }

          return sum;
        },
        0,
      ),
    );

    const gratuityAmount = roundMoney(
      gratuityBase * gratuityPercentage / 100,
    );

    const finalTotal = roundMoney(
      subtotal + gratuityAmount,
    );

    // --------------------------------------------------
    // Find gratuity pricing rule
    // --------------------------------------------------

    const {
      data: gratuityRule,
      error: gratuityRuleError,
    } = await supabase
      .from("pricing_rules")
      .select(`
        id,
        code,
        label,
        calculation_type,
        customer_visible,
        sort_order
      `)
      .eq("code", "gratuity")
      .maybeSingle();

    if (gratuityRuleError) {
      console.error("Gratuity rule lookup error:", gratuityRuleError);

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    const oldGratuityItems = items.filter(
      (item: any) => item.code === "gratuity",
    );

    // Remove legacy gratuity rows first so there is never double-counting.
    if (oldGratuityItems.length > 0) {
      const {
        error: deleteOldGratuityError,
      } = await supabase
        .from("quote_line_items")
        .delete()
        .eq("quote_id", quote.id)
        .eq("code", "gratuity");

      if (deleteOldGratuityError) {
        console.error(
          "Legacy gratuity cleanup error:",
          deleteOldGratuityError,
        );

        return response(
          { ok: false, error: "Quote could not be accepted." },
          500,
        );
      }
    }

    // --------------------------------------------------
    // Add accepted gratuity as system-calculated line item
    // --------------------------------------------------

    if (gratuityPercentage > 0) {
      if (!gratuityRule) {
        console.error("No gratuity pricing rule exists.");

        return response(
          { ok: false, error: "Quote could not be accepted." },
          500,
        );
      }

      const {
        error: gratuityInsertError,
      } = await supabase
        .from("quote_line_items")
        .insert({
          quote_id: quote.id,
          pricing_rule_id: gratuityRule.id,
          code: "gratuity",
          label: gratuityRule.label || "Gratuity",
          calculation_type: "percentage",
          quantity: 1,
          rate: 0,
          percentage: gratuityPercentage,
          amount: gratuityAmount,
          source: "system",
          customer_visible: true,
          sort_order: gratuityRule.sort_order ?? 20,
        });

      if (gratuityInsertError) {
        console.error(
          "Accepted gratuity insert error:",
          gratuityInsertError,
        );

        return response(
          { ok: false, error: "Quote could not be accepted." },
          500,
        );
      }
    }

    // --------------------------------------------------
    // Lock quote
    // --------------------------------------------------

    const acceptedAt = new Date().toISOString();

    const {
      error: quoteUpdateError,
    } = await supabase
      .from("quotes")
      .update({
        gratuity: gratuityAmount,
        total_amount: finalTotal,
        status: "accepted",
        accepted_at: acceptedAt,
        updated_at: acceptedAt,
      })
      .eq("id", quote.id);

    if (quoteUpdateError) {
      console.error("Quote acceptance update error:", quoteUpdateError);

      // Remove newly-added gratuity row to avoid partial accepted pricing.
      await supabase
        .from("quote_line_items")
        .delete()
        .eq("quote_id", quote.id)
        .eq("code", "gratuity");

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    // --------------------------------------------------
    // Move booking to Awaiting Payment
    // --------------------------------------------------

    const {
      error: bookingUpdateError,
    } = await supabase
      .from("bookings")
      .update({
        status: "awaiting_payment",
        updated_at: acceptedAt,
      })
      .eq("id", booking.id);

    if (bookingUpdateError) {
      console.error(
        "Booking awaiting-payment update error:",
        bookingUpdateError,
      );

      // Compensating rollback of quote status/total.
      await supabase
        .from("quotes")
        .update({
          gratuity: Number(quote.gratuity || 0),
          total_amount: Number(quote.total_amount || 0),
          status: quote.status,
          accepted_at: quote.accepted_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", quote.id);

      await supabase
        .from("quote_line_items")
        .delete()
        .eq("quote_id", quote.id)
        .eq("code", "gratuity");

      return response(
        { ok: false, error: "Quote could not be accepted." },
        500,
      );
    }

    return response({
      ok: true,
      already_accepted: false,
      status: "accepted",
      booking_status: "awaiting_payment",
      gratuity_percentage: gratuityPercentage,
      gratuity_base_amount: gratuityBase,
      gratuity: gratuityAmount,
      subtotal,
      final_total: finalTotal,
      currency: "USD",
      accepted_at: acceptedAt,
    });
  } catch (error) {
    console.error("Unexpected accept-public-quote error:", error);

    return response(
      { ok: false, error: "Quote could not be accepted." },
      500,
    );
  }
});
