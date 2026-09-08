(() => {
  const config = window.NYC_LUX_RIDE_BACKEND_CONFIG || {};
  let currentQuote = null;
  let selectedGratuity = 0;
  let currentPublicToken = null;
  let acceptingQuote = false;
  let googleMapsReadyPromise = null;
  const vehicleAssets = {
    escalade: {
      name: "Cadillac Escalade",
      image: "https://www.nycluxride.com/fleet/cadillac-escalade.webp"
    },
    suburban: { name: "Chevrolet Suburban", image: "https://www.nycluxride.com/fleet/chevrolet-suburban.webp" },
    sclass: { name: "Mercedes-Benz S-Class", image: "https://www.nycluxride.com/fleet/mercedes-s-class.webp" },
    navigator: { name: "Lincoln Navigator", image: "https://www.nycluxride.com/fleet/lincoln-navigator.webp" }
  };
  const childSeatAssets = {};
  const elements = {
    loading: document.getElementById("loading-state"),
    message: document.getElementById("message-state"),
    messageMark: document.getElementById("message-mark"),
    messageTitle: document.getElementById("message-title"),
    messageText: document.getElementById("message-text"),
    document: document.getElementById("quote-document")
  };

  function showMessage(title, text = "", mark = "!") {
    elements.loading.hidden = true;
    elements.document.hidden = true;
    elements.messageMark.textContent = mark;
    elements.messageTitle.textContent = title;
    elements.messageText.textContent = text;
    elements.message.hidden = false;
  }

  function display(value, fallback = "—") {
    return value === null || value === undefined || String(value).trim() === "" ? fallback : String(value);
  }

  function formatCurrency(value, currency = "USD") {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value) || 0);
    } catch {
      return `$${(Number(value) || 0).toFixed(2)}`;
    }
  }

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return display(value);
    return new Intl.DateTimeFormat(undefined, includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  function formatTripDate(value) {
    if (!value) return "—";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? display(value) : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function formatTripTime(value) {
    if (!value) return "—";
    const date = new Date(`1970-01-01T${value}`);
    return Number.isNaN(date.getTime()) ? display(value) : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }

  function tripTypeLabel(value) {
    return { "one-way": "One Way", "round-trip": "Round Trip", hourly: "Hourly" }[value] || display(value);
  }

  function friendlyVehicle(value) {
    if (!value) return "—";
    return String(value)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function addTripMeta(label, value) {
    if (value === null || value === undefined || String(value).trim() === "") return;
    const item = document.createElement("div");
    const labelElement = document.createElement("span");
    labelElement.textContent = label;
    const valueElement = document.createElement("strong");
    valueElement.textContent = String(value);
    item.append(labelElement, valueElement);
    document.getElementById("trip-meta").appendChild(item);
  }

  function renderReturnTrip(trip) {
    const returnRoute = document.getElementById("return-route");
    if (trip.trip_type !== "round-trip") return;
    const parts = [
      trip.return_date && `Return date: ${trip.return_date}`,
      trip.return_time && `Return time: ${trip.return_time}`,
      trip.return_pickup_location && `Pickup: ${trip.return_pickup_location}`,
      trip.return_dropoff_location && `Drop-off: ${trip.return_dropoff_location}`
    ].filter(Boolean);
    if (!parts.length) return;
    returnRoute.textContent = parts.join(" · ");
    returnRoute.hidden = false;
  }

  function renderTrip(trip) {
    document.getElementById("trip-meta").replaceChildren();
    addTripMeta("Trip Type", tripTypeLabel(trip.trip_type));
    addTripMeta("Pickup Date", formatTripDate(trip.pickup_date));
    addTripMeta("Pickup Time", formatTripTime(trip.pickup_time));
    addTripMeta("Passengers", trip.passengers);
    addTripMeta("Luggage", trip.luggage);
    if (trip.flight_number) addTripMeta("Flight Number", trip.flight_number);
    document.getElementById("pickup-location").textContent = display(trip.pickup_location);
    document.getElementById("dropoff-location").textContent = display(trip.dropoff_location);
    renderReturnTrip(trip);
  }

  function renderLineItems(items, currency) {
    const container = document.getElementById("line-items");
    container.replaceChildren();
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (currentQuote?.status !== "accepted" && (String(item.code || "").toLowerCase() === "gratuity" || String(item.label || "").toLowerCase() === "gratuity")) return;
      const row = document.createElement("div");
      row.className = "line-item";
      const info = document.createElement("div");
      info.className = "line-item-info";
      const label = document.createElement("span");
      label.className = "line-item-label";
      const percentage = item.percentage !== null && item.percentage !== undefined && Number.isFinite(Number(item.percentage))
        ? ` (${Number(item.percentage)}%)`
        : "";
      label.textContent = `${display(item.label)}${percentage}`;
      info.appendChild(label);
      if (item.quantity !== null && item.quantity !== undefined && item.rate !== null && item.rate !== undefined) {
        const detail = document.createElement("span");
        detail.className = "line-item-detail";
        detail.textContent = `${item.quantity} × ${formatCurrency(item.rate, currency)}`;
        info.appendChild(detail);
      }
      const photoKey = String(item.label || "").toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
      if (childSeatAssets[photoKey]) {
        const photoButton = document.createElement("button");
        photoButton.type = "button";
        photoButton.className = "photo-button";
        photoButton.textContent = "View Photo";
        photoButton.addEventListener("click", () => openPhoto(childSeatAssets[photoKey], item.label));
        info.appendChild(photoButton);
      }
      const amount = document.createElement("span");
      amount.className = "line-item-amount";
      amount.textContent = formatCurrency(item.amount, currency);
      row.append(info, amount);
      container.appendChild(row);
    });
  }

  function openPhoto(src, label) {
    const modal = document.getElementById("photo-modal");
    const image = document.getElementById("photo-modal-image");
    image.src = src;
    image.alt = label || "Vehicle accessory";
    modal.hidden = false;
  }

  document.getElementById("photo-modal-close").addEventListener("click", () => {
    document.getElementById("photo-modal").hidden = true;
  });

  function quoteSubtotal() {
    return (currentQuote?.line_items || [])
      .filter((item) => String(item.label || "").toLowerCase() !== "gratuity")
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  function renderTotals() {
    const currencyCode = currentQuote?.currency || "USD";
    const subtotal = quoteSubtotal();
    const gratuity = (Number(currentQuote?.gratuity_base_amount) || 0) * (selectedGratuity / 100);
    document.getElementById("subtotal-amount").textContent = formatCurrency(subtotal, currencyCode);
    const accepted = currentQuote?.status === "accepted";
    const displayedGratuity = accepted ? (Number(currentQuote.accepted_gratuity) || 0) : gratuity;
    const displayedTotal = accepted ? (Number(currentQuote.accepted_total) || 0) : subtotal + gratuity;
    document.getElementById("gratuity-amount").textContent = formatCurrency(displayedGratuity, currencyCode);
    document.getElementById("total-amount").textContent = `${formatCurrency(displayedTotal, currencyCode)} ${currencyCode}`;
  }

  function setupGratuity() {
    document.querySelectorAll("[data-gratuity]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedGratuity = Number(button.dataset.gratuity) || 0;
        document.querySelectorAll("[data-gratuity]").forEach((option) => option.classList.toggle("selected", option === button));
        renderTotals();
      });
    });
  }

  function showAcceptedQuote(total, currencyCode) {
    document.getElementById("accept-quote-panel").hidden = true;
    document.getElementById("accepted-quote-panel").hidden = false;
    document.querySelector(".gratuity-picker").hidden = true;
    document.getElementById("accepted-total-amount").textContent = `${formatCurrency(total, currencyCode)} ${currencyCode}`;
  }

  async function acceptQuote() {
    if (acceptingQuote || !currentPublicToken || currentQuote?.status === "accepted") return;
    acceptingQuote = true;
    const button = document.getElementById("accept-quote");
    const status = document.getElementById("accept-quote-status");
    button.disabled = true;
    button.textContent = "Accepting your quote...";
    status.hidden = true;
    try {
      const endpoint = `${String(config.supabaseUrl || "").replace(/\/+$/, "")}/functions/v1/accept-public-quote`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.supabasePublishableKey ? { apikey: config.supabasePublishableKey } : {})
        },
        body: JSON.stringify({ token: currentPublicToken, gratuity_percentage: selectedGratuity })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "Quote could not be accepted.");
      }

      const acceptedGratuity = Number(
        payload.gratuity ?? payload.accepted_gratuity ?? 0
      );

      const acceptedTotal = Number(
        payload.final_total ?? payload.accepted_total ?? currentQuote.total_amount ?? 0
      );

      currentQuote.status = "accepted";
      currentQuote.accepted_gratuity = acceptedGratuity;
      currentQuote.accepted_total = acceptedTotal;
      currentQuote.gratuity = acceptedGratuity;
      currentQuote.total_amount = acceptedTotal;

      renderTotals();
      showAcceptedQuote(
        acceptedTotal,
        payload.currency || currentQuote.currency || "USD"
      );
    } catch (error) {
      console.error("Customer quote acceptance error:", error);
      status.textContent = error.message || "Quote could not be accepted.";
      status.hidden = false;
      button.disabled = false;
      button.textContent = "Accept Quote";
    } finally {
      acceptingQuote = false;
    }
  }

  function setupVehicle(quote) {
    const key = String(quote.vehicle || "").toLowerCase();
    const vehicle = vehicleAssets[key];
    document.getElementById("vehicle-name").textContent = vehicle?.name || friendlyVehicle(quote.vehicle);
    const image = document.getElementById("vehicle-image");
    if (!vehicle?.image) return;
    image.src = vehicle.image;
    image.alt = vehicle.name;
    image.hidden = false;
    image.addEventListener("error", () => {
      image.hidden = true;
    }, { once: true });
  }

  function installMapsBootstrap(apiKey) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    if (googleMapsReadyPromise) return googleMapsReadyPromise;

    googleMapsReadyPromise = new Promise((resolve, reject) => {
      const callbackName = "__nycQuoteMapsReady";
      const mapsNamespace = window.google?.maps || (window.google = { maps: {} }).maps;
      const script = document.createElement("script");
      const params = new URLSearchParams({
        key: apiKey,
        v: "weekly",
        loading: "async",
        callback: `google.maps.${callbackName}`
      });
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      mapsNamespace[callbackName] = () => resolve();
      script.onerror = () => reject(new Error("Google Maps could not load."));
      document.head.appendChild(script);
    });

    return googleMapsReadyPromise;
  }

  function decodeRoutePolyline(encoded) {
    const points = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;
    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      latitude += (result & 1) ? ~(result >> 1) : result >> 1;
      result = 0;
      shift = 0;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      longitude += (result & 1) ? ~(result >> 1) : result >> 1;
      points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
    }
    return points;
  }

  function formatDuration(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return "—";
    const hours = Math.floor(value / 60);
    const remaining = value % 60;
    if (hours && remaining) return `${hours} hr ${remaining} min`;
    if (hours) return `${hours} hr`;
    return `${remaining} min`;
  }

  async function renderQuoteMap(trip) {
    const mapElement = document.getElementById("quote-map");
    const statsElement = document.getElementById("stored-route-stats");
    statsElement.innerHTML = `<span>Distance <strong>${Number.isFinite(Number(trip.distance_miles)) ? `${Number(trip.distance_miles).toFixed(1)} miles` : "—"}</strong></span><span>Estimated Drive Time <strong>${formatDuration(trip.estimated_duration_minutes)}</strong></span>`;
    const apiKey = String(window.NYC_LUX_RIDE_CONFIG?.googleMapsApiKey || "").trim();
    const pickup = Number.isFinite(Number(trip.pickup_lat)) && Number.isFinite(Number(trip.pickup_lng))
      ? { lat: Number(trip.pickup_lat), lng: Number(trip.pickup_lng) } : null;
    const dropoff = Number.isFinite(Number(trip.dropoff_lat)) && Number.isFinite(Number(trip.dropoff_lng))
      ? { lat: Number(trip.dropoff_lat), lng: Number(trip.dropoff_lng) } : null;
    if (!apiKey || !pickup || !dropoff || !trip.route_polyline) {
      mapElement.innerHTML = "<div class=\"map-placeholder\">Route map unavailable for this quote.</div>";
      return;
    }
    try {
      await installMapsBootstrap(apiKey);
      const [{ Map }, { LatLngBounds }] = await Promise.all([
        google.maps.importLibrary("maps"),
        google.maps.importLibrary("core")
      ]);
      const path = decodeRoutePolyline(trip.route_polyline);
      if (!path.length) throw new Error("Stored route polyline was empty.");
      mapElement.replaceChildren();
      const map = new Map(mapElement, { center: path[0], zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false });
      const bounds = new LatLngBounds();
      path.forEach((point) => bounds.extend(point));
      new google.maps.Polyline({ path, map, strokeColor: "#b88b3e", strokeOpacity: 0.9, strokeWeight: 5 });
      new google.maps.Marker({ map, position: pickup, title: "Pickup" });
      new google.maps.Marker({ map, position: dropoff, title: "Drop-off" });
      map.fitBounds(bounds, 42);
    } catch (error) {
      console.error("Quote map error:", error);
      mapElement.innerHTML = "<div class=\"map-placeholder\">Route map unavailable for this quote.</div>";
    }
  }

  function renderQuote(quote) {
    currentQuote = quote;
    const customerName = quote.customer?.first_name;
    document.getElementById("greeting").textContent = customerName
      ? `Hi ${customerName}, your quote is ready.`
      : "Your quote is ready.";
    document.getElementById("request-reference").textContent = display(quote.request_code);
    document.getElementById("prepared-date").textContent = formatDate(quote.created_at);
    renderTrip(quote.trip || {});
    setupVehicle(quote);
    renderLineItems(quote.line_items, quote.currency || "USD");
    document.getElementById("currency-label").textContent = quote.currency || "USD";
    setupGratuity();
    document.getElementById("accept-quote").onclick = acceptQuote;
    renderTotals();
    if (quote.status === "accepted") {
      selectedGratuity = Number(quote.accepted_gratuity) && Number(quote.gratuity_base_amount)
        ? Math.round((Number(quote.accepted_gratuity) / Number(quote.gratuity_base_amount)) * 100)
        : 0;
      showAcceptedQuote(quote.accepted_total, quote.currency || "USD");
    }

    if (quote.customer_note && String(quote.customer_note).trim()) {
      document.getElementById("customer-note-text").textContent = quote.customer_note;
      document.getElementById("customer-note").hidden = false;
    }
    elements.loading.hidden = true;
    elements.message.hidden = true;
    elements.document.hidden = false;
  }

  async function initializeQuotePage(token) {
    const quote = await loadQuote(token);
    if (!quote) return;
    currentPublicToken = token;
    const trip = quote.trip || {};
    renderQuote(quote);
    await renderQuoteMap(trip);
  }

  async function loadQuote(token) {
    const endpoint = `${String(config.supabaseUrl || "").replace(/\/+$/, "")}/functions/v1/get-public-quote`;
    if (!config.supabaseUrl) {
      showMessage("We couldn't load your quote right now.", "Please try again or contact NYC Lux Ride.");
      return;
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.supabasePublishableKey ? { apikey: config.supabasePublishableKey } : {})
        },
        body: JSON.stringify({ token })
      });
      const payload = await response.json();
      if (payload.expired === true) {
        showMessage("This quote has expired.", "Please contact NYC Lux Ride for an updated quote.");
        return;
      }
      if (response.status === 404 || payload.error === "Quote not found.") {
        showMessage("We couldn't find this quote.");
        return;
      }
      if (!response.ok || payload.ok !== true || !payload.quote) {
        throw new Error(payload.error || `Quote request failed with status ${response.status}.`);
      }
      return payload.quote;
    } catch (error) {
      console.error("Customer quote load error:", error);
      showMessage("We couldn't load your quote right now.", "Please try again or contact NYC Lux Ride.");
      return null;
    }
  }

  const token = new URLSearchParams(window.location.search).get("token");
  if (!token) {
    showMessage("Quote link is invalid.");
  } else {
    initializeQuotePage(token).catch((error) => {
      console.error("Customer quote initialization error:", error);
      showMessage("We couldn't load your quote right now.", "Please try again or contact NYC Lux Ride.");
    });
  }
})();
