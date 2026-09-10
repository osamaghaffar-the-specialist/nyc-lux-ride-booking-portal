(() => {
  "use strict";

  /*
  ============================================================
  NYC LUX RIDE — REVIEW VEHICLE FEATURES
  ============================================================

  Vehicle features are intentionally hidden on
  the Choose Vehicle screen.

  They are displayed only on Review & Confirm.
  ============================================================
  */

  const chosenVehicle =
    document.getElementById("chosenVehicle");

  const toReview =
    document.getElementById("toReview");

  if (!chosenVehicle) {
    console.warn(
      "Review features: #chosenVehicle not found."
    );
    return;
  }


  /*
  ============================================================
  STYLE
  ============================================================
  */

  const style = document.createElement("style");

  style.textContent = `

    .review-vehicle-features {
      margin-top: 16px;
      width: 100%;
      border: 1px solid #dfd9cf;
      border-radius: 11px;
      overflow: hidden;
      background: #faf8f4;
    }

    .review-vehicle-features-title {
      padding: 10px 13px;
      background: #f3eee5;
      border-bottom: 1px solid #dfd9cf;
      color: #76531e;
      font-size: 9px;
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: .12em;
    }

    .review-vehicle-features-table {
      width: 100%;
      border-collapse: collapse;
    }

    .review-vehicle-features-table tr:not(:last-child) {
      border-bottom: 1px solid #e8e2d9;
    }

    .review-vehicle-features-table td {
      padding: 9px 12px;
      font-size: 11px;
      color: #3f3932;
      vertical-align: middle;
    }

    .review-vehicle-feature-check {
      width: 30px;
      padding-right: 0 !important;
      color: #b88b3e !important;
      font-size: 13px !important;
      font-weight: 900;
    }

    @media (max-width: 700px) {

      .review-vehicle-features {
        margin-top: 13px;
      }

      .review-vehicle-features-table td {
        font-size: 10px;
      }

    }

  `;

  document.head.appendChild(style);


  /*
  ============================================================
  ESCAPE HTML
  ============================================================
  */

  function escapeHtml(value) {
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


  /*
  ============================================================
  RENDER FEATURES
  ============================================================
  */

  function renderVehicleFeatures() {

    /*
    Remove an old table first so duplicates
    can never appear.
    */

    const existing =
      chosenVehicle.querySelector(
        ".review-vehicle-features"
      );

    if (existing) {
      existing.remove();
    }


    /*
    Existing booking system variables from index.html.
    */

    if (
      typeof state === "undefined" ||
      typeof vehicleData === "undefined" ||
      !state.selectedVehicle
    ) {
      return;
    }


    const vehicle =
      vehicleData[state.selectedVehicle];

    if (!vehicle) {
      return;
    }


    const features =
      Array.isArray(vehicle.features)
        ? vehicle.features.filter(Boolean)
        : [];


    /*
    If Admin has not selected features,
    don't show an empty section.
    */

    if (!features.length) {
      return;
    }


    /*
    chosenVehicle normally contains:
      image
      information div

    We insert the table inside the information area.
    */

    const information =
      Array.from(chosenVehicle.children)
        .find(element =>
          element.tagName !== "IMG"
        );

    if (!information) {
      return;
    }


    const section =
      document.createElement("div");

    section.className =
      "review-vehicle-features";


    const rows =
      features
        .map(
          feature => `
            <tr>

              <td class="review-vehicle-feature-check">
                ✓
              </td>

              <td>
                ${escapeHtml(feature)}
              </td>

            </tr>
          `
        )
        .join("");


    section.innerHTML = `

      <div class="review-vehicle-features-title">
        Vehicle Features
      </div>

      <table class="review-vehicle-features-table">

        <tbody>
          ${rows}
        </tbody>

      </table>

    `;


    information.appendChild(section);
  }


  /*
  ============================================================
  REVIEW BUTTON
  ============================================================
  */

  if (toReview) {

    toReview.addEventListener(
      "click",
      () => {

        /*
        Existing index.html click handler renders
        the review first.

        Running on the next event loop lets that
        finish before features are inserted.
        */

        window.setTimeout(
          renderVehicleFeatures,
          0
        );

      }
    );

  }


  /*
  ============================================================
  WATCH REVIEW VEHICLE
  ============================================================

  This also handles cases where the existing
  renderReview() redraws #chosenVehicle.
  ============================================================
  */

  let renderScheduled = false;

  const observer =
    new MutationObserver(() => {

      if (renderScheduled) {
        return;
      }

      /*
      If our table already exists there is
      nothing to rebuild.
      */

      if (
        chosenVehicle.querySelector(
          ".review-vehicle-features"
        )
      ) {
        return;
      }

      renderScheduled = true;

      window.setTimeout(() => {

        renderScheduled = false;

        renderVehicleFeatures();

      }, 0);

    });


  observer.observe(
    chosenVehicle,
    {
      childList: true,
      subtree: true
    }
  );

})();