(() => {
  "use strict";

  const config = window.NYC_LUX_RIDE_BACKEND_CONFIG;

  if (
    !config?.supabaseUrl ||
    !config?.supabasePublishableKey
  ) {
    console.warn(
      "Dynamic vehicles: Supabase config unavailable."
    );
    return;
  }

  const grid =
    document.getElementById("vehicleGrid");

  if (!grid) {
    console.warn(
      "Dynamic vehicles: #vehicleGrid not found."
    );
    return;
  }


  /*
  ============================================================
  LEGACY FALLBACK IMAGES
  ============================================================

  These remain available until every vehicle receives
  its own managed featured photo from Admin Vehicle
  Management.
  ============================================================
  */

  const legacyImages = {
    escalade:
      "https://www.nycluxride.com/fleet/cadillac-escalade.webp",

    suburban:
      "https://www.nycluxride.com/fleet/chevrolet-suburban.webp",

    sclass:
      "https://www.nycluxride.com/fleet/mercedes-s-class.webp",

    navigator:
      "https://www.nycluxride.com/fleet/lincoln-navigator.webp"
  };


  /*
  ============================================================
  HELPERS
  ============================================================
  */

  function escapeVehicleHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[character]
    );
  }


  function vehicleImage(vehicle) {
    return (
      vehicle.image_url ||
      legacyImages[vehicle.code] ||
      ""
    );
  }


  function capacityText(vehicle) {
    const capacity =
      Number(vehicle.passenger_capacity);

    if (
      !Number.isFinite(capacity) ||
      capacity <= 0
    ) {
      return "Passenger capacity available on request";
    }

    return `Up to ${capacity} ${
      capacity === 1
        ? "passenger"
        : "passengers"
    }`;
  }


  function luggageText(vehicle) {
    const capacity =
      Number(vehicle.luggage_capacity);

    if (
      !Number.isFinite(capacity) ||
      capacity < 0
    ) {
      return "Luggage capacity available on request";
    }

    return `Up to ${capacity} ${
      capacity === 1
        ? "luggage item"
        : "luggage items"
    }`;
  }


  function featureLabels(vehicle) {
    if (!Array.isArray(vehicle.features)) {
      return [];
    }

    return vehicle.features
      .map(feature => feature?.label)
      .filter(Boolean);
  }


  /*
  ============================================================
  BUILD CUSTOMER VEHICLE CARD
  ============================================================

  IMPORTANT:
  Features are intentionally NOT rendered here.

  They remain stored inside vehicleData so that the
  Review & Confirm page can display them later.
  ============================================================
  */

  function buildVehicleCard(vehicle) {
    const article =
      document.createElement("article");

    article.className =
      "vehicle-card";

    article.dataset.vehicleId =
      vehicle.code;

    const imageUrl =
      vehicleImage(vehicle);

    article.innerHTML = `
      <div class="vehicle-img">

        ${
          imageUrl
            ? `
              <img
                src="${escapeVehicleHtml(imageUrl)}"
                alt="${escapeVehicleHtml(vehicle.name)}"
                loading="lazy" decoding="async" fetchpriority="low"
              />
            `
            : `
              <div
                style="
                  width:100%;
                  height:100%;
                  min-height:210px;
                  display:grid;
                  place-items:center;
                  background:#eee9e0;
                  color:#777066;
                  font-size:13px;
                "
              >
                Vehicle photo coming soon
              </div>
            `
        }

      </div>

      <div class="vehicle-content">

        <div class="vehicle-top">

          <div>

            <h3>
              ${escapeVehicleHtml(vehicle.name)}
            </h3>

            <div class="vehicle-sub">
              ${escapeVehicleHtml(
                vehicle.category ||
                "Luxury Vehicle"
              )}
            </div>

          </div>

        </div>

        <div class="specs">

          <span class="spec">
            ${escapeVehicleHtml(
              capacityText(vehicle)
            )}
          </span>

          <span class="spec">
            ${escapeVehicleHtml(
              luggageText(vehicle)
            )}
          </span>

        </div>

        <button
          class="select-vehicle"
          type="button"
        >
          Select Vehicle
        </button>

      </div>
    `;

    return article;
  }


  /*
  ============================================================
  SYNC SUPABASE VEHICLES WITH EXISTING BOOKING SYSTEM
  ============================================================

  index.html already contains vehicleData and the
  Review / booking flow uses that same object.

  We replace the old hardcoded vehicle information
  with the live Supabase information.
  ============================================================
  */

  function syncVehicleData(vehicles) {
    if (
      typeof vehicleData === "undefined"
    ) {
      throw new Error(
        "Existing vehicleData object could not be found."
      );
    }

    Object
      .keys(vehicleData)
      .forEach(key => {
        delete vehicleData[key];
      });


    vehicles.forEach(vehicle => {

      vehicleData[vehicle.code] = {

        /*
        Database identifiers
        */

        id:
          vehicle.id,

        code:
          vehicle.code,


        /*
        Customer-facing data
        */

        name:
          vehicle.name ||
          "Luxury Vehicle",

        type:
          vehicle.category ||
          "Luxury Vehicle",

        img:
          vehicleImage(vehicle),

        capacity:
          capacityText(vehicle),

        luggage:
          luggageText(vehicle),

        description:
          vehicle.description ||
          "",


        /*
        Features remain available for
        Review & Confirm page.

        They are NOT displayed on Step 2.
        */

        features:
          featureLabels(vehicle)
      };

    });
  }


  /*
  ============================================================
  RESTORE SAVED VEHICLE SELECTION
  ============================================================
  */

  function restoreVehicleSelection() {
    if (
      typeof state === "undefined" ||
      !state.selectedVehicle
    ) {
      return;
    }

    const selectedCard =
      [
        ...grid.querySelectorAll(
          ".vehicle-card"
        )
      ].find(
        card =>
          card.dataset.vehicleId ===
          state.selectedVehicle
      );


    /*
    Previously selected vehicle may have been disabled
    or removed from customer portal by Admin.
    */

    if (!selectedCard) {

      state.selectedVehicle = null;

      const reviewButton =
        document.getElementById(
          "toReview"
        );

      if (reviewButton) {
        reviewButton.disabled = true;
      }

      if (
        typeof saveDraft ===
        "function"
      ) {
        saveDraft();
      }

      return;
    }


    grid
      .querySelectorAll(
        ".vehicle-card"
      )
      .forEach(card => {

        const selected =
          card === selectedCard;

        card.classList.toggle(
          "selected",
          selected
        );

        const button =
          card.querySelector(
            ".select-vehicle"
          );

        if (button) {

          button.textContent =
            selected
              ? "Selected ✓"
              : "Select Vehicle";

        }

      });


    const reviewButton =
      document.getElementById(
        "toReview"
      );

    if (reviewButton) {
      reviewButton.disabled = false;
    }
  }


  /*
  ============================================================
  VEHICLE SELECTION
  ============================================================
  */

  function bindDynamicSelection() {

    grid
      .querySelectorAll(
        ".vehicle-card"
      )
      .forEach(card => {

        card.addEventListener(
          "click",
          () => {

            if (
              typeof state ===
              "undefined"
            ) {
              return;
            }


            /*
            Keep compatibility with existing booking flow.

            selectedVehicle stores the stable vehicle code:
            bmw
            escalade
            suburban
            sclass
            navigator
            etc.
            */

            state.selectedVehicle =
              card.dataset.vehicleId;


            /*
            Update visual selected state
            */

            grid
              .querySelectorAll(
                ".vehicle-card"
              )
              .forEach(otherCard => {

                const selected =
                  otherCard === card;

                otherCard.classList.toggle(
                  "selected",
                  selected
                );

                const button =
                  otherCard.querySelector(
                    ".select-vehicle"
                  );

                if (button) {

                  button.textContent =
                    selected
                      ? "Selected ✓"
                      : "Select Vehicle";

                }

              });


            /*
            Enable Review button
            */

            const reviewButton =
              document.getElementById(
                "toReview"
              );

            if (reviewButton) {
              reviewButton.disabled = false;
            }


            /*
            Preserve existing draft behavior
            */

            if (
              typeof saveDraft ===
              "function"
            ) {
              saveDraft();
            }

          }
        );

      });
  }


  /*
  ============================================================
  PUBLIC SUPABASE API
  ============================================================
  */

  async function fetchPublicVehicles() {

    const endpoint =
      `${config.supabaseUrl}/rest/v1/rpc/get_public_vehicles`;


    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {

            apikey:
              config.supabasePublishableKey,

            Authorization:
              `Bearer ${config.supabasePublishableKey}`,

            "Content-Type":
              "application/json"
          },

          body: "{}"
        }
      );


    if (!response.ok) {

      let detail = "";

      try {
        detail =
          await response.text();
      } catch (_) {}


      throw new Error(
        `Vehicle API returned ${
          response.status
        }${
          detail
            ? `: ${detail}`
            : ""
        }`
      );
    }


    const result =
      await response.json();


    return Array.isArray(result)
      ? result
      : [];
  }


  /*
  ============================================================
  LOAD VEHICLES
  ============================================================
  */

  async function loadManagedVehicles() {

    try {

      const vehicles =
        await fetchPublicVehicles();


      /*
      Important fail-safe:

      If Supabase unexpectedly returns zero vehicles,
      don't destroy the existing working hardcoded fleet.
      */

      if (!vehicles.length) {

        console.warn(
          "Dynamic vehicles: no customer-visible vehicles returned. Keeping fallback fleet."
        );

        return;
      }


      /*
      Update global booking vehicle information
      */

      syncVehicleData(vehicles);


      /*
      Build new customer cards
      */

      const fragment =
        document.createDocumentFragment();


      vehicles.forEach(vehicle => {

        fragment.appendChild(
          buildVehicleCard(vehicle)
        );

      });


      /*
      Only replace old hardcoded cards once
      Supabase has successfully returned data.
      */

      grid.replaceChildren(
        fragment
      );


      /*
      Bind existing selection behavior
      */

      bindDynamicSelection();


      /*
      Restore saved draft vehicle if appropriate
      */

      restoreVehicleSelection();


      console.info(
        `Dynamic vehicles loaded: ${
          vehicles.length
        }`
      );


    } catch (error) {

      /*
      Critical fail-safe.

      If Supabase fails, existing hardcoded vehicle
      cards remain usable.
      */

      console.error(
        "Dynamic vehicle loading failed:",
        error
      );

    }
  }


  /*
  ============================================================
  INITIALIZE
  ============================================================
  */

  loadManagedVehicles();

})();