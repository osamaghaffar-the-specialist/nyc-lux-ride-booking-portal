import { withSupabase } from "jsr:@supabase/server@^1";

type PlaceInput = {
  type?: string | null;
  address: string;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type StopInput = {
  address: string;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
};

interface BookingPayload {
  trip_type: "one-way" | "round-trip" | "hourly";

  hourly_hours?: number | null;

  pickup_date: string;
  pickup_time: string;

  pickup: PlaceInput;
  dropoff: PlaceInput;

  distance_miles?: number | null;
  estimated_duration_minutes?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  route_polyline?: string | null;

  passengers: number;
  luggage?: number | null;

  flight_number?: string | null;
  trip_notes?: string | null;

  preferred_vehicle_code?: string | null;

  stops?: StopInput[];

  return_trip?: {
    date: string;
    time: string;

    pickup: PlaceInput;
    dropoff: PlaceInput;

    passengers?: number | null;
    flight_number?: string | null;

    stops?: StopInput[];
  } | null;

  customer: {
    first_name: string;
    last_name: string;

    email: string;

    phone_e164: string;
    phone_country?: string | null;
    phone_dial_code?: string | null;

    consent_transactional: boolean;
  };
}

const cleanText = (
  value: unknown,
  maxLength = 500,
): string | null => {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();

  if (!cleaned) return null;

  return cleaned.slice(0, maxLength);
};

const requiredText = (
  value: unknown,
  field: string,
  maxLength = 500,
): string => {
  const cleaned = cleanText(value, maxLength);

  if (!cleaned) {
    throw new Error(`${field} is required.`);
  }

  return cleaned;
};

const nullableNumber = (value: unknown): number | null => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};

const positiveInteger = (
  value: unknown,
  field: string,
): number => {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {
    throw new Error(`${field} must be at least 1.`);
  }

  return number;
};

const nonNegativeInteger = (
  value: unknown,
): number | null => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0
  ) {
    return null;
  }

  return number;
};

const validateEmail = (email: string) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const validatePhone = (phone: string) => {
  return /^\+[1-9]\d{6,14}$/.test(phone);
};

const validateDate = (date: string) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
};

const validateTime = (time: string) => {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(time);
};

export default {
  fetch: withSupabase(
    {
      auth: "none",
    },

    async (req, ctx) => {
      const apiKey = req.headers.get("apikey");

const publishableKeys = JSON.parse(
  Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"
);

const validPublishableKey =
  apiKey &&
  Object.values(publishableKeys).includes(apiKey);

if (!validPublishableKey) {
  return Response.json(
    {
      ok: false,
      error: "Unauthorized request.",
    },
    {
      status: 401,
    },
  );
}
      if (req.method !== "POST") {
        return Response.json(
          {
            ok: false,
            error: "Method not allowed.",
          },
          {
            status: 405,
          },
        );
      }

      try {
        const body: BookingPayload = await req.json();

        // --------------------------------------------------
        // BASIC TRIP VALIDATION
        // --------------------------------------------------

        const allowedTripTypes = [
          "one-way",
          "round-trip",
          "hourly",
        ];

        if (!allowedTripTypes.includes(body.trip_type)) {
          throw new Error("Invalid trip type.");
        }

        const pickupDate = requiredText(
          body.pickup_date,
          "Pickup date",
          20,
        );

        const pickupTime = requiredText(
          body.pickup_time,
          "Pickup time",
          20,
        );

        if (!validateDate(pickupDate)) {
          throw new Error("Invalid pickup date.");
        }

        if (!validateTime(pickupTime)) {
          throw new Error("Invalid pickup time.");
        }

        const pickupAddress = requiredText(
          body.pickup?.address,
          "Pickup location",
          1000,
        );

        const dropoffAddress = requiredText(
          body.dropoff?.address,
          "Drop-off location",
          1000,
        );

        const passengers = positiveInteger(
          body.passengers,
          "Passengers",
        );

        // --------------------------------------------------
        // CUSTOMER VALIDATION
        // --------------------------------------------------

        const firstName = requiredText(
          body.customer?.first_name,
          "First name",
          100,
        );

        const lastName = requiredText(
          body.customer?.last_name,
          "Last name",
          100,
        );

        const email = requiredText(
          body.customer?.email,
          "Email",
          320,
        ).toLowerCase();

        if (!validateEmail(email)) {
          throw new Error("Invalid email address.");
        }

        const phone = requiredText(
          body.customer?.phone_e164,
          "Phone number",
          30,
        );

        if (!validatePhone(phone)) {
          throw new Error(
            "Phone number must be in international format.",
          );
        }

        // --------------------------------------------------
        // HOURLY VALIDATION
        // --------------------------------------------------

        let hourlyHours: number | null = null;

        if (body.trip_type === "hourly") {
          hourlyHours = nullableNumber(
            body.hourly_hours,
          );

          if (
            hourlyHours === null ||
            hourlyHours < 0.5 ||
            hourlyHours > 10 ||
            (hourlyHours * 2) % 1 !== 0
          ) {
            throw new Error(
              "Hourly duration must be between 0.5 and 10 hours.",
            );
          }
        }

        // --------------------------------------------------
        // ROUND TRIP VALIDATION
        // --------------------------------------------------

        let returnTrip:
          | BookingPayload["return_trip"]
          | null = null;

        if (body.trip_type === "round-trip") {
          returnTrip = body.return_trip ?? null;

          if (!returnTrip) {
            throw new Error(
              "Return trip information is required.",
            );
          }

          if (
            !validateDate(
              requiredText(
                returnTrip.date,
                "Return date",
                20,
              ),
            )
          ) {
            throw new Error("Invalid return date.");
          }

          if (
            !validateTime(
              requiredText(
                returnTrip.time,
                "Return time",
                20,
              ),
            )
          ) {
            throw new Error("Invalid return time.");
          }

          requiredText(
            returnTrip.pickup?.address,
            "Return pickup",
            1000,
          );

          requiredText(
            returnTrip.dropoff?.address,
            "Return drop-off",
            1000,
          );
        }

        // --------------------------------------------------
        // INSERT BOOKING
        // --------------------------------------------------

        const bookingInsert = {
          status: "new",

          trip_type: body.trip_type,

          hourly_hours:
            body.trip_type === "hourly"
              ? hourlyHours
              : null,

          pickup_date: pickupDate,
          pickup_time: pickupTime,

          pickup_type:
            cleanText(body.pickup?.type, 50),

          pickup_address: pickupAddress,

          pickup_place_id:
            cleanText(
              body.pickup?.place_id,
              500,
            ),

          pickup_lat:
            nullableNumber(body.pickup_lat ?? body.pickup?.lat),

          pickup_lng:
            nullableNumber(body.pickup_lng ?? body.pickup?.lng),

          dropoff_type:
            cleanText(body.dropoff?.type, 50),

          dropoff_address: dropoffAddress,

          dropoff_place_id:
            cleanText(
              body.dropoff?.place_id,
              500,
            ),

          dropoff_lat:
            nullableNumber(body.dropoff_lat ?? body.dropoff?.lat),

          dropoff_lng:
            nullableNumber(body.dropoff_lng ?? body.dropoff?.lng),

          route_polyline:
            cleanText(body.route_polyline, 200000),

          distance_miles:
            nullableNumber(
              body.distance_miles,
            ),

          estimated_duration_minutes:
            nonNegativeInteger(
              body.estimated_duration_minutes,
            ),

          passengers,

          luggage:
            nonNegativeInteger(body.luggage),

          flight_number:
            cleanText(
              body.flight_number,
              100,
            ),

          trip_notes:
            cleanText(
              body.trip_notes,
              3000,
            ),

          preferred_vehicle_code:
            cleanText(
              body.preferred_vehicle_code,
              100,
            ),

          // RETURN TRIP

          return_date:
            body.trip_type === "round-trip"
              ? returnTrip!.date
              : null,

          return_time:
            body.trip_type === "round-trip"
              ? returnTrip!.time
              : null,

          return_pickup_type:
            body.trip_type === "round-trip"
              ? cleanText(
                  returnTrip!.pickup?.type,
                  50,
                )
              : null,

          return_pickup_address:
            body.trip_type === "round-trip"
              ? requiredText(
                  returnTrip!.pickup?.address,
                  "Return pickup",
                  1000,
                )
              : null,

          return_pickup_place_id:
            body.trip_type === "round-trip"
              ? cleanText(
                  returnTrip!.pickup?.place_id,
                  500,
                )
              : null,

          return_pickup_lat:
            body.trip_type === "round-trip"
              ? nullableNumber(
                  returnTrip!.pickup?.lat,
                )
              : null,

          return_pickup_lng:
            body.trip_type === "round-trip"
              ? nullableNumber(
                  returnTrip!.pickup?.lng,
                )
              : null,

          return_dropoff_type:
            body.trip_type === "round-trip"
              ? cleanText(
                  returnTrip!.dropoff?.type,
                  50,
                )
              : null,

          return_dropoff_address:
            body.trip_type === "round-trip"
              ? requiredText(
                  returnTrip!.dropoff?.address,
                  "Return drop-off",
                  1000,
                )
              : null,

          return_dropoff_place_id:
            body.trip_type === "round-trip"
              ? cleanText(
                  returnTrip!.dropoff?.place_id,
                  500,
                )
              : null,

          return_dropoff_lat:
            body.trip_type === "round-trip"
              ? nullableNumber(
                  returnTrip!.dropoff?.lat,
                )
              : null,

          return_dropoff_lng:
            body.trip_type === "round-trip"
              ? nullableNumber(
                  returnTrip!.dropoff?.lng,
                )
              : null,

          return_passengers:
            body.trip_type === "round-trip"
              ? nonNegativeInteger(
                  returnTrip!.passengers,
                )
              : null,

          return_flight_number:
            body.trip_type === "round-trip"
              ? cleanText(
                  returnTrip!.flight_number,
                  100,
                )
              : null,

          // CUSTOMER

          first_name: firstName,
          last_name: lastName,

          email,

          phone_e164: phone,

          phone_country:
            cleanText(
              body.customer?.phone_country,
              10,
            ),

          phone_dial_code:
            cleanText(
              body.customer?.phone_dial_code,
              10,
            ),

          consent_transactional:
            body.customer?.consent_transactional === true,
        };

        const {
          data: booking,
          error: bookingError,
        } = await ctx.supabaseAdmin
          .from("bookings")
          .insert(bookingInsert)
          .select(
            "id, request_code, status, created_at",
          )
          .single();

        if (bookingError) {
          console.error(
            "Booking insert error:",
            bookingError,
          );

          throw new Error(
            "Unable to create booking.",
          );
        }

        // --------------------------------------------------
        // ADDITIONAL STOPS
        // --------------------------------------------------

        const stopRows: Record<
          string,
          unknown
        >[] = [];

        const outboundStops =
          Array.isArray(body.stops)
            ? body.stops
            : [];

        outboundStops.forEach(
          (stop, index) => {
            const address = cleanText(
              stop?.address,
              1000,
            );

            if (!address) return;

            stopRows.push({
              booking_id: booking.id,

              leg: "outbound",

              stop_order: index + 1,

              address,

              place_id:
                cleanText(
                  stop?.place_id,
                  500,
                ),

              lat:
                nullableNumber(stop?.lat),

              lng:
                nullableNumber(stop?.lng),
            });
          },
        );

        if (
          body.trip_type === "round-trip" &&
          Array.isArray(
            returnTrip?.stops,
          )
        ) {
          returnTrip!.stops!.forEach(
            (stop, index) => {
              const address = cleanText(
                stop?.address,
                1000,
              );

              if (!address) return;

              stopRows.push({
                booking_id: booking.id,

                leg: "return",

                stop_order: index + 1,

                address,

                place_id:
                  cleanText(
                    stop?.place_id,
                    500,
                  ),

                lat:
                  nullableNumber(stop?.lat),

                lng:
                  nullableNumber(stop?.lng),
              });
            },
          );
        }

        if (stopRows.length > 0) {
          const {
            error: stopError,
          } = await ctx.supabaseAdmin
            .from("booking_stops")
            .insert(stopRows);

          if (stopError) {
            console.error(
              "Booking stops error:",
              stopError,
            );

            // Roll back booking if stops fail.
            await ctx.supabaseAdmin
              .from("bookings")
              .delete()
              .eq("id", booking.id);

            throw new Error(
              "Unable to save booking stops.",
            );
          }
        }

        // --------------------------------------------------
        // SUCCESS
        // --------------------------------------------------

        return Response.json(
          {
            ok: true,

            booking: {
              id: booking.id,
              request_code:
                booking.request_code,
              status:
                booking.status,
              created_at:
                booking.created_at,
            },
          },
          {
            status: 201,
          },
        );
      } catch (error) {
        console.error(
          "submit-booking error:",
          error,
        );

        const message =
          error instanceof Error
            ? error.message
            : "Unable to submit booking.";

        return Response.json(
          {
            ok: false,
            error: message,
          },
          {
            status: 400,
          },
        );
      }
    },
  ),
};