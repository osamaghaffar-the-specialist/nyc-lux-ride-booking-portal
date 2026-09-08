import { withSupabase } from "jsr:@supabase/server@^1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const invalidLink = () =>
  json({ ok: false, error: "Invalid quote link." }, 400);

const nullableNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export default {
  fetch: withSupabase(
    { auth: "none" },
    async (req, ctx) => {
      if (req.method === "OPTIONS") {
        return new Response("", { status: 204, headers: corsHeaders });
      }

      if (req.method !== "POST") {
        return json({ ok: false, error: "Method not allowed." }, 405);
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return invalidLink();
      }

      const token =
        typeof body === "object" && body !== null && "token" in body
          ? (body as { token?: unknown }).token
          : null;

      if (typeof token !== "string" || !uuidPattern.test(token.trim())) {
        return invalidLink();
      }

      const { data: quote, error: quoteError } = await ctx.supabaseAdmin
        .from("quotes")
        .select("id, public_token, booking_id, version, status, currency, total_amount, gratuity, accepted_at, customer_note, valid_until, created_at")
        .eq("public_token", token.trim())
        .maybeSingle();

      if (quoteError) {
        console.error("Public quote lookup error:", quoteError);
        return json({ ok: false, error: "Quote could not be loaded." }, 500);
      }

      if (!quote) {
        return json({ ok: false, error: "Quote not found." }, 404);
      }

      if (quote.valid_until && new Date() > new Date(quote.valid_until)) {
        return json(
          { ok: false, expired: true, error: "This quote has expired." },
          410,
        );
      }

      const { data: booking, error: bookingError } = await ctx.supabaseAdmin
        .from("bookings")
        .select("request_code, trip_type, pickup_date, pickup_time, pickup_type, pickup_address, pickup_lat, pickup_lng, dropoff_type, dropoff_address, dropoff_lat, dropoff_lng, route_polyline, distance_miles, estimated_duration_minutes, return_date, return_time, return_pickup_type, return_pickup_address, return_dropoff_type, return_dropoff_address, passengers, luggage, flight_number, preferred_vehicle_code, first_name")
        .eq("id", quote.booking_id)
        .maybeSingle();

      if (bookingError) {
        console.error("Public quote booking lookup error:", bookingError);
        return json({ ok: false, error: "Quote could not be loaded." }, 500);
      }

      if (!booking) {
        return json({ ok: false, error: "Quote not found." }, 404);
      }

      const { data: lineItems, error: lineItemsError } = await ctx.supabaseAdmin
        .from("quote_line_items")
        .select("label, quantity, rate, percentage, amount, calculation_type, sort_order, gratuity_eligible, code")
        .eq("quote_id", quote.id)
        .eq("customer_visible", true)
        .order("sort_order", { ascending: true });

      if (lineItemsError) {
        console.error("Public quote line item lookup error:", lineItemsError);
        return json({ ok: false, error: "Quote could not be loaded." }, 500);
      }

      const customerLineItems = (lineItems ?? []).filter(
        (item) => String(item.code || "").toLowerCase() !== "gratuity" &&
          String(item.label || "").toLowerCase() !== "gratuity"
      );
      const acceptedGratuityItem = quote.status === "accepted"
        ? (lineItems || []).find((item) => String(item.code || "").toLowerCase() === "gratuity")
        : null;
      const subtotal = customerLineItems.reduce(
        (sum, item) => sum + (typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : 0),
        0,
      );
      const gratuityBaseAmount = customerLineItems
        .filter((item) => item.gratuity_eligible === true)
        .reduce(
          (sum, item) => sum + (typeof item.amount === "number" && Number.isFinite(item.amount) ? Math.max(0, item.amount) : 0),
          0,
        );

      return json({
        ok: true,
        quote: {
          request_code: booking.request_code,
          version: quote.version,
          status: quote.status,
          currency: quote.currency,
          total_amount: subtotal,
          gratuity_base_amount: gratuityBaseAmount,
          accepted_at: quote.accepted_at,
          accepted_gratuity: quote.status === "accepted" ? nullableNumber(quote.gratuity) : null,
          accepted_total: quote.status === "accepted" ? nullableNumber(quote.total_amount) : null,
          customer_note: quote.customer_note,
          valid_until: quote.valid_until,
          created_at: quote.created_at,
          customer: {
            first_name: booking.first_name,
          },
          trip: {
            trip_type: booking.trip_type,
            pickup_date: booking.pickup_date,
            pickup_time: booking.pickup_time,
            pickup_type: booking.pickup_type,
            pickup_location: booking.pickup_address,
            pickup_lat: nullableNumber(booking.pickup_lat),
            pickup_lng: nullableNumber(booking.pickup_lng),
            dropoff_type: booking.dropoff_type,
            dropoff_location: booking.dropoff_address,
            dropoff_lat: nullableNumber(booking.dropoff_lat),
            dropoff_lng: nullableNumber(booking.dropoff_lng),
            route_polyline: booking.route_polyline,
            distance_miles: nullableNumber(booking.distance_miles),
            estimated_duration_minutes: booking.estimated_duration_minutes,
            ...(booking.trip_type === "round-trip"
              ? {
                  return_date: booking.return_date,
                  return_time: booking.return_time,
                  return_pickup_type: booking.return_pickup_type,
                  return_pickup_location: booking.return_pickup_address,
                  return_dropoff_type: booking.return_dropoff_type,
                  return_dropoff_location: booking.return_dropoff_address,
                }
              : {}),
            passengers: booking.passengers,
            luggage: booking.luggage,
            flight_number: booking.flight_number,
          },
          vehicle: booking.preferred_vehicle_code,
          line_items: [...customerLineItems, ...(acceptedGratuityItem ? [acceptedGratuityItem] : [])].map((item) => ({
            label: item.label,
            quantity: nullableNumber(item.quantity),
            rate: nullableNumber(item.rate),
            percentage: nullableNumber(item.percentage),
            amount: nullableNumber(item.amount),
            calculation_type: item.calculation_type,
          })),
        },
      });
    },
  ),
};
