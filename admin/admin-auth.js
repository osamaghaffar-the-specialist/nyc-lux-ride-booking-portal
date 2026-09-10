(() => {
  const config = window.NYC_LUX_RIDE_BACKEND_CONFIG;
  const supabaseLibrary = window.supabase;
  const page = document.body.dataset.page;

  if (!config || !supabaseLibrary) {
    showError("The admin portal could not connect to its authentication service.");
    return;
  }

  const supabase = supabaseLibrary.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );

  function isNumericOperatorInput(element) {
    return element instanceof HTMLInputElement && element.type === "number";
  }

  function selectZeroValue(element) {
    if (/^0(?:\.0+)?$/.test(element.value)) {
      element.select();
    }
  }

  function normalizeNumericInput(element) {
    if (!isNumericOperatorInput(element)) return;
    if (/^0+\d/.test(element.value)) {
      element.value = element.value.replace(/^0+(?=\d)/, "");
    }
  }

  // Delegation keeps dynamically created quote and pricing inputs consistent.
  document.addEventListener("focusin", (event) => {
    if (isNumericOperatorInput(event.target)) selectZeroValue(event.target);
  });
  document.addEventListener("input", (event) => {
    if (isNumericOperatorInput(event.target)) normalizeNumericInput(event.target);
  });

  function showError(message) {
    const errorElement = document.getElementById("auth-error");
    if (!errorElement) return;
    errorElement.textContent = message;
    errorElement.hidden = false;
  }

  function clearError() {
    const errorElement = document.getElementById("auth-error");
    if (!errorElement) return;
    errorElement.textContent = "";
    errorElement.hidden = true;
  }

  async function getActiveAdminProfile(userId) {
    const { data, error } = await supabase
      .from("admin_profiles")
      .select("full_name, active")
      .eq("id", userId)
      .eq("active", true)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function signOutAndRedirect() {
    await supabase.auth.signOut();
    window.location.replace("login.html");
  }

  const bookingStatuses = [
    "new",
    "reviewing",
    "quoted",
    "awaiting_payment",
    "paid",
    "confirmed",
    "completed",
    "cancelled"
  ];
  let bookings = [];
  let bookingDetail = null;
  let bookingDetailId = null;
  let pricingRules = [];
  let quotePricingRules = [];
  let quoteComponents = new Map();
  let resolvedQuoteAmounts = new Map();
  let currentAdminUserId = null;

  function showDashboardError(message) {
    const alertElement = document.getElementById("dashboard-alert");
    if (!alertElement) return;
    alertElement.textContent = message;
    alertElement.hidden = false;
  }

  function setTableState(message) {
    document.getElementById("bookings-body").innerHTML =
      `<tr><td class="table-state" colspan="9">${message}</td></tr>`;
  }

  function displayValue(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return "â€”";
    }
    return String(value);
  }

  function getCustomerName(booking) {
    const firstName = booking.first_name || booking.customer?.first_name || "";
    const lastName = booking.last_name || booking.customer?.last_name || "";
    return displayValue(`${firstName} ${lastName}`.trim());
  }

  function formatDate(value) {
    if (!value) return "â€”";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return displayValue(value);
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function statusLabel(status) {
    const labels = {
      new: "New",
      reviewing: "Reviewing",
      quoted: "Quoted",
      awaiting_payment: "Awaiting Payment",
      paid: "Paid",
      confirmed: "Confirmed",
      completed: "Completed",
      cancelled: "Cancelled"
    };
    return labels[status] || displayValue(status);
  }

  function createCell(value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = displayValue(value);
    if (className) cell.className = className;
    return cell;
  }

  function createRequestCell(booking) {
    const cell = document.createElement("td");
    const link = document.createElement("a");
    link.className = "request-code request-link";
    link.href = `booking.html?id=${encodeURIComponent(booking.id || "")}`;
    link.textContent = displayValue(booking.request_code);
    cell.appendChild(link);
    return cell;
  }

  function createStatusCell(status) {
    const cell = document.createElement("td");
    const badge = document.createElement("span");
    const normalizedStatus = String(status || "unknown").toLowerCase().replace(/_/g, "-");
    badge.className = `status-badge status-${normalizedStatus}`;
    badge.textContent = statusLabel(status);
    cell.appendChild(badge);
    return cell;
  }

  function matchesSearch(booking, searchTerm) {
    if (!searchTerm) return true;
    const searchable = [
      booking.request_code,
      getCustomerName(booking),
      booking.email || booking.customer?.email,
      booking.phone_e164 || booking.phone || booking.customer?.phone
    ].join(" ").toLowerCase();
    return searchable.includes(searchTerm);
  }

  function renderBookings() {
    const searchTerm = document.getElementById("booking-search").value.trim().toLowerCase();
    const statusFilter = document.getElementById("status-filter").value;
    const visibleBookings = bookings.filter((booking) => {
      const matchesStatus = !statusFilter || booking.status === statusFilter;
      return matchesStatus && matchesSearch(booking, searchTerm);
    });
    const bookingsBody = document.getElementById("bookings-body");

    if (!visibleBookings.length) {
      setTableState("No booking requests found.");
      return;
    }

    bookingsBody.replaceChildren();
    visibleBookings.forEach((booking) => {
      const row = document.createElement("tr");
      row.appendChild(createRequestCell(booking));
      row.appendChild(createCell(getCustomerName(booking)));
      row.appendChild(createCell(booking.trip_type));
      row.appendChild(createCell(booking.pickup_date));
      row.appendChild(createCell(booking.pickup_address));
      row.appendChild(createCell(booking.dropoff_address));
      row.appendChild(createCell(booking.preferred_vehicle_code));
      row.appendChild(createStatusCell(booking.status));
      row.appendChild(createCell(formatDate(booking.created_at), "cell-muted"));
      bookingsBody.appendChild(row);
    });
  }

  function renderStats(counts) {
    const statElements = {
      new: document.getElementById("stat-new"),
      quoted: document.getElementById("stat-quoted"),
      awaiting_payment: document.getElementById("stat-awaiting-payment"),
      confirmed: document.getElementById("stat-confirmed"),
      completed: document.getElementById("stat-completed")
    };
    Object.entries(statElements).forEach(([status, element]) => {
      element.textContent = counts[status] || 0;
    });
  }

  async function fetchBookingData() {
    const bookingQuery = supabase
      .from("bookings")
      .select("id, request_code, first_name, last_name, email, phone_e164, trip_type, pickup_date, pickup_address, dropoff_address, preferred_vehicle_code, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    const statusQuery = supabase
      .from("bookings")
      .select("status");

    const [bookingResult, statusResult] = await Promise.all([
      bookingQuery,
      statusQuery
    ]);

    if (bookingResult.error) {
      throw bookingResult.error;
    }

    if (statusResult.error) {
      throw statusResult.error;
    }

    const counts = Object.fromEntries(
      bookingStatuses.map(status => [status, 0])
    );

    (statusResult.data || []).forEach(row => {
      if (
        Object.prototype.hasOwnProperty.call(
          counts,
          row.status
        )
      ) {
        counts[row.status] += 1;
      }
    });

    return {
      bookings: bookingResult.data || [],
      counts
    };
  }

  async function loadBookings() {
    const refreshButton = document.getElementById("refresh-bookings");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    document.getElementById("dashboard-alert").hidden = true;
    setTableState("Loading booking requests...");

    try {
      const result = await fetchBookingData();
      bookings = result.bookings;
      renderStats(result.counts);
      renderBookings();
    } catch (error) {
      console.error("Unable to load bookings:", error);
      setTableState("Unable to load booking requests.");
      showDashboardError(error.message || "Unable to load booking requests from Supabase.");
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh Bookings";
    }
  }

  function setupBookingControls() {
    document.getElementById("booking-search").addEventListener("input", renderBookings);
    document.getElementById("status-filter").addEventListener("change", renderBookings);
    document.getElementById("refresh-bookings").addEventListener("click", loadBookings);
  }

  function setDetailValue(id, value) {
    const element = document.getElementById(id);
    const hasValue = value !== null && value !== undefined && String(value).trim() !== "";
    element.textContent = hasValue ? String(value) : "â€”";
    element.classList.toggle("is-empty", !hasValue);
  }

  function formatMeasure(value, unit) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    return `${value} ${unit}`;
  }

  function setDetailStatus(status) {
    const statusElement = document.getElementById("summary-status");
    const badge = document.createElement("span");
    const normalizedStatus = String(status || "unknown").toLowerCase().replace(/_/g, "-");
    badge.className = `status-badge status-${normalizedStatus}`;
    badge.textContent = statusLabel(status);
    statusElement.replaceChildren(badge);
  }

  function setActionAlert(message, type = "") {
    const alertElement = document.getElementById("booking-action-alert");
    alertElement.textContent = message;
    alertElement.className = `action-alert${type ? ` ${type}-alert` : ""}`;
    alertElement.hidden = false;
  }

  function createActionButton(label, nextStatus, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `action-button${className ? ` ${className}` : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => updateBookingStatus(nextStatus));
    return button;
  }

  function renderBookingActions(status) {
    const actionsElement = document.getElementById("booking-actions");
    actionsElement.replaceChildren();

    const copy = document.createElement("p");
    copy.className = "action-copy";
    const primaryAction = {
      new: () => actionsElement.appendChild(createActionButton("Start Review", "reviewing")),
      reviewing: () => {
        copy.textContent = "Create a customer quote to continue this booking.";
        actionsElement.appendChild(copy);
        const ready = document.createElement("p");
        ready.className = "action-complete";
        ready.textContent = "Ready for Quote";
        actionsElement.appendChild(ready);
      },
      quoted: () => {
        const complete = document.createElement("p");
        complete.className = "action-complete";
        complete.textContent = "Quote Created";
        actionsElement.appendChild(complete);
      },
      awaiting_payment: () => {
        const complete = document.createElement("p");
        complete.className = "action-complete";
        complete.textContent = "Awaiting Customer Payment";
        actionsElement.appendChild(complete);
      },
      paid: () => {
        const complete = document.createElement("p");
        complete.className = "action-complete";
        complete.textContent = "Payment Received";
        actionsElement.appendChild(complete);
      },
      confirmed: () => actionsElement.appendChild(createActionButton("Mark Completed", "completed")),
      completed: () => {
        const complete = document.createElement("p");
        complete.className = "action-complete";
        complete.textContent = "Booking Completed";
        actionsElement.appendChild(complete);
      },
      cancelled: () => {
        const complete = document.createElement("p");
        complete.className = "action-complete";
        complete.textContent = "Booking Cancelled";
        actionsElement.appendChild(complete);
      }
    };
    primaryAction[status]?.();

    document.getElementById("quote-builder").hidden = status !== "reviewing";

    if (status !== "completed" && status !== "cancelled") {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "action-button danger-button";
      cancelButton.textContent = "Cancel Booking";
      cancelButton.addEventListener("click", () => {
        if (window.confirm("Cancel this booking request?")) {
          updateBookingStatus("cancelled");
        }
      });
      actionsElement.appendChild(cancelButton);
    }
  }

  function quoteMetadata(rule) {
    if (!rule.metadata) return {};
    if (typeof rule.metadata === "object") return rule.metadata;
    try {
      return JSON.parse(rule.metadata);
    } catch {
      return {};
    }
  }

  function currency(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
  }

  function quoteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function quoteRuleLabel(rule) {
    return rule.code === "custom_charge" ? "Custom Charge" : displayValue(rule.label);
  }

  function addChargeLabel(rule) {
    const labels = {
      airport_fee: "Airport / Terminal Fee",
      meet_greet: "Meet & Greet",
      rear_facing_seat: "Rear-facing Seat",
      forward_facing_seat: "Forward-facing Seat",
      booster_seat: "Booster Seat",
      additional_stop: "Additional Stop",
      wait_time: "Wait Time",
      service_charge: "Service Charge",
      custom_charge: "Custom Charge"
    };
    return labels[rule.code] || rule.label || "Charge";
  }

  function quoteControlValue(component, field) {
    return component?.card?.querySelector(`[data-quote-field="${field}"]`);
  }

  function setGratuityOption(component, option, customField, optionRow) {
    component.selectedGratuityOption = option;
    component.active = true;
    const includeToggle = quoteControlValue(component, "active");
    if (includeToggle) includeToggle.checked = true;
    component.card.classList.add("is-active");
    customField.hidden = option !== "custom";
    customField.style.display = option === "custom" ? "grid" : "none";
    optionRow.querySelectorAll(".quick-option-button").forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.gratuityOption === option);
    });
  }

  function calculateGratuityEligibleSubtotal() {
    let subtotal = 0;
    const baseFareRule = quotePricingRules.find((rule) => rule.code === "base_fare");
    const baseFareComponent = baseFareRule && quoteComponents.get(baseFareRule.id);
    const baseFareInput = baseFareComponent?.card?.querySelector('[data-quote-field="rate"]');
    const baseFareAmount = Math.max(0, quoteNumber(baseFareInput?.value || 0));

    if (baseFareRule?.gratuity_eligible === true) {
      subtotal += baseFareAmount;
    }

    quoteComponents.forEach((component, ruleId) => {
      const code = String(component.rule.code || "").toLowerCase();
      if (code === "base_fare" || code === "gratuity" || code === "discount") return;
      if (!component.active || component.rule.gratuity_eligible !== true) return;
      subtotal += Math.max(0, resolvedQuoteAmounts.get(ruleId) || 0);
    });

    const gratuityComponent = [...quoteComponents.values()].find(
      (component) => String(component.rule.code || "").toLowerCase() === "gratuity"
    );
    const selectedGratuityPercentage = Math.max(
      0,
      quoteNumber(quoteControlValue(gratuityComponent, "percentage")?.value)
    );
    const gratuityAmount = gratuityComponent?.active
      ? subtotal * (selectedGratuityPercentage / 100)
      : 0;

    console.log("BASE FARE CURRENT VALUE:", baseFareAmount);
    console.log("BASE FARE RULE:", baseFareRule);
    console.log("BASE FARE GRATUITY ELIGIBLE:", baseFareRule?.gratuity_eligible);
    console.log("GRATUITY ELIGIBLE SUBTOTAL:", subtotal);
    console.log("GRATUITY PERCENT:", selectedGratuityPercentage);
    console.log("GRATUITY AMOUNT:", gratuityAmount);

    return subtotal;
  }

  function calculateQuote() {
    const activeComponents = [];
    quoteComponents.forEach((component, ruleId) => {
      const rule = component.rule;
      const active = rule.code === "base_fare" || component.active;
      if (!active) return;
      const calculationType = String(rule.calculation_type || "manual").toLowerCase();
      const rate = quoteNumber(quoteControlValue(component, "rate")?.value);
      const percentage = Math.max(0, quoteNumber(quoteControlValue(component, "percentage")?.value));
      const quantity = Math.max(0, quoteNumber(quoteControlValue(component, "quantity")?.value));
      let amount = rate;
      if (calculationType === "per_unit") amount = quantity * rate;
      if (calculationType === "percentage") amount = percentage;
      if (rule.code === "base_fare") amount = Math.max(0, rate);
      activeComponents.push({ ruleId, component, rule, calculationType, rate, percentage, quantity, amount });
    });

    const baseFare = activeComponents.find((item) => item.rule.code === "base_fare");
    const isGratuity = (item) => String(item.rule.code).toLowerCase() === "gratuity";
    const isDiscount = (item) => String(item.rule.code).toLowerCase().includes("discount");
    let subtotal = 0;
    const resolvedNonGratuity = new Map();
    activeComponents.filter((item) => !isGratuity(item)).forEach((item) => {
      let amount = item.amount;
      if (item.calculationType === "percentage") {
        const discountMode = quoteControlValue(item.component, "discount_mode")?.value;
        if (isDiscount(item) && discountMode === "fixed") {
          amount = -Math.abs(quoteNumber(quoteControlValue(item.component, "fixed_amount")?.value));
        } else {
          amount = subtotal * (item.percentage / 100);
          if (isDiscount(item)) amount = -Math.abs(amount);
        }
      } else if (isDiscount(item)) {
        amount = -Math.abs(amount);
      }
      resolvedNonGratuity.set(item.ruleId, amount);
      if (!isDiscount(item)) subtotal += amount;
    });

    resolvedQuoteAmounts = resolvedNonGratuity;
    const gratuityEligibleTotal = calculateGratuityEligibleSubtotal();

    const calculated = activeComponents.map((item) => {
      let amount = resolvedNonGratuity.get(item.ruleId) ?? item.amount;
      if (isGratuity(item)) {
        amount = gratuityEligibleTotal * (item.percentage / 100);
      }
      return { ...item, amount };
    });
    const total = calculated.reduce((sum, item) => sum + item.amount, 0);
    quoteComponents.forEach((component) => {
      if (String(component.rule.code).toLowerCase() !== "gratuity") return;
      const calculationNote = component.card?.querySelector(".quote-charge-calc");
      if (!calculationNote) return;
      const gratuityItem = calculated.find((item) => String(item.rule.code).toLowerCase() === "gratuity");
      calculationNote.textContent = gratuityItem && component.active
        ? `${gratuityItem.percentage}% of ${currency(gratuityEligibleTotal)} = ${currency(gratuityItem.amount)}`
        : "Gratuity not included";
    });
    return { calculated, total, baseFare };
  }

  function refreshQuoteSummary() {
    const result = calculateQuote();
    const lines = document.getElementById("quote-summary-lines");
    lines.replaceChildren();
    result.calculated.forEach((item) => {
      const row = document.createElement("div");
      row.className = `quote-summary-line${String(item.rule.code).toLowerCase().includes("discount") ? " discount-line" : ""}`;
      const label = document.createElement("span");
      label.textContent = item.component.customLabel || quoteRuleLabel(item.rule);
      const amount = document.createElement("span");
      amount.textContent = currency(item.amount);
      row.append(label, amount);
      lines.appendChild(row);
      const calculationNote = item.component.card.querySelector(".quote-charge-calc");
      if (calculationNote) {
        if (item.calculationType === "per_unit") {
          calculationNote.textContent = `${item.quantity} Ã— ${currency(item.rate)} = ${currency(item.amount)}`;
        } else if (item.calculationType === "percentage") {
          calculationNote.textContent = `${item.percentage}% = ${currency(item.amount)}`;
        } else {
          calculationNote.textContent = `Calculated Amount: ${currency(item.amount)}`;
        }
      }
    });
    document.getElementById("quote-live-total").textContent = currency(result.total);
    document.getElementById("quote-summary-total").textContent = currency(result.total);
    return result;
  }

  function createQuoteField(label, field, value, type = "number") {
    const wrapper = document.createElement("label");
    wrapper.className = "quote-charge-field";
    const title = document.createElement("span");
    title.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.dataset.quoteField = field;
    input.value = value ?? "";
    if (type === "number") {
      input.min = "0";
      input.step = "0.01";
    }
    wrapper.append(title, input);
    return wrapper;
  }

  function createQuoteCharge(rule, options = {}) {
    const metadata = quoteMetadata(rule);
    const component = { rule, active: rule.code === "base_fare" || options.optional === true, customLabel: "" };
    if (rule.code !== "base_fare" && rule.code !== "gratuity") component.active = rule.auto_apply === true;
    if (options.optional === true) component.active = true;
    if (rule.code === "gratuity") component.selectedGratuityOption = null;
    const card = document.createElement("article");
    card.className = "quote-charge";
    card.dataset.ruleId = rule.id;
    card.dataset.ruleCode = rule.code;
    const header = document.createElement("div");
    header.className = "quote-charge-header";
    const title = document.createElement("div");
    title.className = "quote-charge-title";
    const label = document.createElement("strong");
    label.textContent = quoteRuleLabel(rule);
    title.appendChild(label);
    header.appendChild(title);
    if (rule.code === "gratuity") {
      const toggle = document.createElement("label");
      toggle.className = "quote-charge-toggle";
      toggle.textContent = "Include";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = component.active;
      checkbox.dataset.quoteToggle = "active";
      checkbox.dataset.quoteField = "active";
      toggle.appendChild(checkbox);
      header.appendChild(toggle);
      checkbox.addEventListener("change", () => {
        component.active = checkbox.checked;
        card.classList.toggle("is-active", component.active);
        if (rule.code === "gratuity" && !component.active) {
          component.selectedGratuityOption = null;
          card.querySelectorAll(".quick-option-button").forEach((button) => button.classList.remove("is-selected"));
          const customField = card.querySelector('[data-quote-field="percentage"]')?.closest(".quote-charge-field");
          if (customField) {
            customField.hidden = true;
            customField.style.display = "none";
          }
          const percentageInput = quoteControlValue(component, "percentage");
          if (percentageInput) percentageInput.value = "";
        }
        refreshQuoteSummary();
      });
    } else if (options.optional === true) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "quote-charge-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => removeSelectedCharge(rule.id));
      header.appendChild(removeButton);
    }
    card.appendChild(header);

    const fields = document.createElement("div");
    fields.className = "quote-charge-fields";
    const type = String(rule.calculation_type || "manual").toLowerCase();
    if (rule.code === "custom_charge") fields.appendChild(createQuoteField("Custom Label", "custom_label", "", "text"));
    if (type === "per_unit") {
      fields.appendChild(createQuoteField("Quantity", "quantity", rule.auto_apply ? 1 : 0));
      fields.appendChild(createQuoteField("Rate per Unit", "rate", rule.default_value ?? 0));
    } else if (type === "percentage") {
      const fixedDiscountAllowed = metadata.allow_fixed === true || metadata.percentage_and_fixed === true ||
        (Array.isArray(metadata.modes) && metadata.modes.includes("fixed"));
      if (String(rule.code).toLowerCase().includes("discount") && fixedDiscountAllowed) {
        const mode = document.createElement("label");
        mode.className = "quote-charge-field";
        const modeLabel = document.createElement("span");
        modeLabel.textContent = "Discount Mode";
        const select = document.createElement("select");
        select.dataset.quoteField = "discount_mode";
        const percentageOption = new Option("Percentage", "percentage");
        const fixedOption = new Option("Fixed USD", "fixed");
        select.append(percentageOption, fixedOption);
        mode.append(modeLabel, select);
        fields.appendChild(mode);
        fields.appendChild(createQuoteField("Fixed Discount", "fixed_amount", 0));
        const fixedField = fields.lastElementChild;
        fixedField.hidden = true;
        select.addEventListener("change", () => {
          fixedField.hidden = select.value !== "fixed";
          refreshQuoteSummary();
        });
      }
      const options = [15, 16, 20];
      if (rule.code === "gratuity") {
        const quick = document.createElement("div");
        quick.className = "quote-charge-field gratuity-options-field";
        const quickLabel = document.createElement("span");
        quickLabel.textContent = "Gratuity Options";
        const optionRow = document.createElement("div");
        optionRow.className = "quick-option-row";
        const percentageInput = createQuoteField("Custom Gratuity %", "percentage", "");
        percentageInput.hidden = true;
        percentageInput.style.display = "none";
        options.forEach((option) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "quick-option-button";
          button.dataset.gratuityOption = String(option);
          button.textContent = `${option}%`;
          button.addEventListener("click", () => {
            setGratuityOption(component, String(option), percentageInput, optionRow);
            quoteControlValue(component, "percentage").value = option;
            refreshQuoteSummary();
          });
          optionRow.appendChild(button);
        });
        const customButton = document.createElement("button");
        customButton.type = "button";
        customButton.className = "quick-option-button";
        customButton.dataset.gratuityOption = "custom";
        customButton.textContent = "Custom";
        customButton.addEventListener("click", () => {
          setGratuityOption(component, "custom", percentageInput, optionRow);
          quoteControlValue(component, "percentage").focus();
          refreshQuoteSummary();
        });
        optionRow.appendChild(customButton);
        quick.append(quickLabel, optionRow, percentageInput);
        fields.appendChild(quick);
      } else {
        fields.appendChild(createQuoteField("Percentage", "percentage", rule.default_value ?? 0));
      }
    } else {
      fields.appendChild(createQuoteField(type === "auto" ? "Amount / Operator Override" : "Amount", "rate", rule.default_value ?? 0));
    }
    card.appendChild(fields);
    const calculation = document.createElement("p");
    calculation.className = "quote-charge-calc";
    card.appendChild(calculation);
    fields.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("input", refreshQuoteSummary);
      input.addEventListener("change", refreshQuoteSummary);
    });
    component.card = card;
    quoteComponents.set(rule.id, component);
    card.classList.toggle("is-active", component.active);
    return card;
  }

  function removeSelectedCharge(ruleId) {
    const component = quoteComponents.get(ruleId);
    if (!component || component.rule.code === "base_fare" || component.rule.code === "gratuity") return;
    quoteComponents.delete(ruleId);
    component.card?.remove();
    renderAddChargePanel();
    refreshQuoteSummary();
  }

  function renderAddChargePanel() {
    const panel = document.getElementById("add-charge-panel");
    panel.replaceChildren();
    const availableRules = quotePricingRules.filter((rule) =>
      rule.code !== "base_fare" && rule.code !== "gratuity" && !quoteComponents.has(rule.id)
    );
    if (!availableRules.length) {
      const empty = document.createElement("p");
      empty.className = "add-charge-panel-heading";
      empty.textContent = "All enabled charges are selected";
      panel.appendChild(empty);
      return;
    }
    const commonCodes = ["tolls", "meet_greet", "airport_fee", "parking", "rear_facing_seat"];
    const common = availableRules.filter((rule) => commonCodes.includes(rule.code));
    const more = availableRules.filter((rule) => !commonCodes.includes(rule.code));
    const addRuleButton = (rule) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = addChargeLabel(rule);
      button.addEventListener("click", () => {
        const card = createQuoteCharge(rule, { optional: true });
        document.getElementById("selected-charge-controls").appendChild(card);
        panel.hidden = true;
        refreshQuoteSummary();
        renderAddChargePanel();
      });
      return button;
    };
    if (common.length) {
      const commonHeading = document.createElement("p");
      commonHeading.className = "add-charge-panel-heading";
      commonHeading.textContent = "Common Charges";
      panel.appendChild(commonHeading);
      common.forEach((rule) => panel.appendChild(addRuleButton(rule)));
    }
    if (more.length) {
      const moreHeading = document.createElement("p");
      moreHeading.className = "add-charge-panel-heading";
      moreHeading.textContent = "More Charges";
      panel.appendChild(moreHeading);
      more.forEach((rule) => panel.appendChild(addRuleButton(rule)));
    }
  }
async function loadVehiclePricingSuggestion() {
  const baseFareRule = quotePricingRules.find(
    (rule) => rule.code === "base_fare"
  );

  const baseComponent =
    baseFareRule && quoteComponents.get(baseFareRule.id);

  const baseInput =
    baseComponent &&
    quoteControlValue(baseComponent, "rate");

  const container =
    document.getElementById("base-fare-control");

  if (!container || !baseInput || !bookingDetail) {
    return;
  }

  /*
   * Remove old suggestion if this function runs again.
   */
  container
    .querySelector(".vehicle-pricing-suggestion")
    ?.remove();

  const vehicleCode =
    String(
      bookingDetail.preferred_vehicle_code || ""
    ).trim();

  const tripType =
    String(
      bookingDetail.trip_type || ""
    ).trim();

  if (!vehicleCode || !tripType) {
    return;
  }

  /*
   * Round-trip pricing is intentionally kept manual
   * until we know that booking.distance_miles contains
   * the COMPLETE round-trip mileage.
   */
  if (tripType === "round-trip") {
    return;
  }

  const distanceMiles =
    tripType === "hourly"
      ? null
      : Number(bookingDetail.distance_miles);

  const hourlyHours =
    tripType === "hourly"
      ? Number(bookingDetail.hourly_hours)
      : null;

  const tripDate =
    bookingDetail.pickup_date || null;

  try {
    const result = await supabase.rpc(
      "calculate_vehicle_base_fare",
      {
        p_vehicle_code: vehicleCode,
        p_trip_type: tripType,
        p_distance_miles:
          Number.isFinite(distanceMiles)
            ? distanceMiles
            : null,
        p_hourly_hours:
          Number.isFinite(hourlyHours)
            ? hourlyHours
            : null,
        p_trip_date: tripDate
      }
    );

    if (result.error) {
      throw result.error;
    }

    const pricing = result.data;

    /*
     * Pricing not configured / automation disabled:
     * keep manual Base Fare silently available.
     */
    if (!pricing || pricing.ok !== true) {
      console.info(
        "Automated vehicle pricing unavailable:",
        pricing?.error || "Unknown reason"
      );
      return;
    }

    const suggested =
      Number(pricing.suggested_base_fare);

    if (!Number.isFinite(suggested)) {
      return;
    }

    const card =
      document.createElement("article");

    card.className =
      "vehicle-pricing-suggestion";

    card.style.cssText = `
      margin-bottom:16px;
      padding:18px;
      border:1px solid #d8c49f;
      border-radius:12px;
      background:linear-gradient(180deg,#fffdf8,#f8f0e2);
    `;

    const heading =
      document.createElement("div");

    heading.innerHTML = `
      <div style="
        font-size:10px;
        font-weight:800;
        letter-spacing:.14em;
        text-transform:uppercase;
        color:#946b27;
        margin-bottom:6px;
      ">
        Automated Vehicle Pricing
      </div>

      <div style="
        font-size:18px;
        font-weight:700;
        margin-bottom:14px;
      ">
        ${pricing.vehicle_name || vehicleCode}
      </div>
    `;

    card.appendChild(heading);

    const details =
      document.createElement("div");

    details.style.cssText = `
      display:grid;
      gap:8px;
      margin-bottom:16px;
    `;

    const addRow = (label, value) => {
      const row =
        document.createElement("div");

      row.style.cssText = `
        display:flex;
        justify-content:space-between;
        gap:20px;
        padding-bottom:7px;
        border-bottom:1px solid rgba(0,0,0,.07);
        font-size:13px;
      `;

      const left =
        document.createElement("span");

      left.textContent = label;
      left.style.color = "#6b6256";

      const right =
        document.createElement("strong");

      right.textContent = value;

      row.append(left, right);
      details.appendChild(row);
    };

    if (pricing.pricing_mode === "distance") {
      addRow(
        "Trip Distance",
        `${Number(pricing.distance_miles).toFixed(1)} miles`
      );

      addRow(
        "Trip Rate",
        `${currency(pricing.trip_rate_per_mile)} / mile`
      );

      addRow(
        "Calculated Mileage Fare",
        currency(pricing.raw_trip_fare)
      );
    }

    if (
      pricing.pricing_mode === "weekday_hourly" ||
      pricing.pricing_mode === "weekend_hourly"
    ) {
      addRow(
        "Pricing Mode",
        pricing.pricing_mode === "weekend_hourly"
          ? "Weekend Hourly"
          : "Weekday Hourly"
      );

      addRow(
        "Requested Hours",
        String(pricing.requested_hours)
      );

      addRow(
        "Billable Hours",
        String(pricing.billable_hours)
      );

      addRow(
        "Hourly Rate",
        `${currency(pricing.hourly_rate)} / hour`
      );
    }

    if (
      pricing.minimum_base_rate !== null &&
      pricing.minimum_base_rate !== undefined
    ) {
      addRow(
        "Minimum Base Fare",
        currency(pricing.minimum_base_rate)
      );
    }

    card.appendChild(details);

    const suggestion =
      document.createElement("div");

    suggestion.style.cssText = `
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:18px;
      padding-top:3px;
    `;

    const amountWrap =
      document.createElement("div");

    amountWrap.innerHTML = `
      <div style="
        font-size:9px;
        font-weight:800;
        letter-spacing:.12em;
        text-transform:uppercase;
        color:#75644b;
        margin-bottom:3px;
      ">
        Suggested Base Fare
      </div>

      <strong style="
        font-size:25px;
        font-family:Georgia,'Times New Roman',serif;
      ">
        ${currency(suggested)}
      </strong>
    `;

    const applyButton =
      document.createElement("button");

    applyButton.type = "button";

    applyButton.textContent =
      `Apply ${currency(suggested)}`;

    applyButton.style.cssText = `
      border:0;
      background:#111;
      color:#d5b06b;
      padding:12px 16px;
      border-radius:9px;
      font-weight:800;
      cursor:pointer;
    `;

    applyButton.addEventListener(
      "click",
      () => {
        baseInput.value =
          suggested.toFixed(2);

        baseInput.dispatchEvent(
          new Event("input", {
            bubbles: true
          })
        );

        refreshQuoteSummary();

        applyButton.textContent =
          "Applied âœ“";
      }
    );

    suggestion.append(
      amountWrap,
      applyButton
    );

    card.appendChild(suggestion);

    /*
     * Put suggestion ABOVE existing Base Fare control.
     */
    container.prepend(card);

  } catch (error) {
    console.error(
      "Vehicle pricing suggestion error:",
      error
    );

    /*
     * Never break the manual quote builder.
     */
  }
}
  async function loadQuotePricingRules() {
    const result = await supabase
      .from("pricing_rules")
      .select("*")
      .eq("enabled", true)
      .order("sort_order", { ascending: true });

    if (result.error) throw result.error;

    quotePricingRules = (result.data || []).filter(
      (rule) => String(rule.code || "").toLowerCase() !== "gratuity"
    );

    const baseFare = quotePricingRules.find(
      (rule) => rule.code === "base_fare"
    );

    if (!baseFare) {
      throw new Error("Base Fare pricing rule could not be found.");
    }

    quoteComponents = new Map();

    const controls =
      document.getElementById("quote-rule-controls");

    document
      .getElementById("base-fare-control")
      .replaceChildren();

    document
      .getElementById("selected-charge-controls")
      .replaceChildren();

    document.getElementById(
      "add-charge-panel"
    ).hidden = true;

    document
      .getElementById("base-fare-control")
      .appendChild(
        createQuoteCharge(baseFare)
      );

    renderAddChargePanel();

    document.getElementById(
      "add-charge"
    ).onclick = () => {
      const panel =
        document.getElementById(
          "add-charge-panel"
        );

      panel.hidden = !panel.hidden;
    };

    controls.hidden = false;

    document.getElementById(
      "quote-rules-loading"
    ).hidden = true;

    refreshQuoteSummary();

    /*
     * Vehicle-specific automated pricing suggestion.
     * Manual Base Fare remains available.
     */
    await loadVehiclePricingSuggestion();
  }
  function showQuoteBuilderError(error) {
    console.error("Quote builder error:", error);
    const alertElement = document.getElementById("quote-builder-alert");
    alertElement.textContent = error.message || "Quote builder could not be loaded.";
    alertElement.hidden = false;
  }

  function renderExistingQuote(quote, lineItems) {
    const card = document.getElementById("existing-quote");
    card.hidden = false;
    document.getElementById("existing-quote-total").textContent = currency(quote.total_amount);
    const summary = document.getElementById("existing-quote-summary");
    summary.replaceChildren();
    lineItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "quote-summary-line";
      const label = document.createElement("span");
      label.textContent = displayValue(item.label || item.code);
      const amount = document.createElement("span");
      amount.textContent = currency(item.amount);
      row.append(label, amount);
      summary.appendChild(row);
    });
  }

  function getCustomerQuoteUrl(publicToken) {
    const quoteUrl = new URL("../quote.html", window.location.href);
    quoteUrl.searchParams.set("token", publicToken);
    return quoteUrl.toString();
  }

  function renderCustomerQuoteAccess(quote) {
    const section = document.getElementById("customer-quote-access");
    const viewButton = document.getElementById("view-customer-quote");
    const copyButton = document.getElementById("copy-quote-link");
    const alertElement = document.getElementById("customer-quote-access-alert");
    const hasToken = typeof quote.public_token === "string" && quote.public_token.trim() !== "";
    section.hidden = false;
    alertElement.hidden = true;
    viewButton.disabled = !hasToken;
    copyButton.disabled = !hasToken;

    if (!hasToken) {
      alertElement.textContent = "Customer quote link is not available.";
      alertElement.className = "action-alert";
      alertElement.hidden = false;
      viewButton.onclick = null;
      copyButton.onclick = null;
      return;
    }

    const quoteUrl = getCustomerQuoteUrl(quote.public_token);
    viewButton.onclick = () => window.open(quoteUrl, "_blank", "noopener,noreferrer");
    copyButton.onclick = async () => {
      try {
        await navigator.clipboard.writeText(quoteUrl);
        alertElement.textContent = "Customer quote link copied.";
        alertElement.className = "action-alert success-alert";
        alertElement.hidden = false;
      } catch (error) {
        console.error("Customer quote link copy error:", error);
        alertElement.textContent = "Customer quote link could not be copied.";
        alertElement.className = "action-alert error-alert";
        alertElement.hidden = false;
      }
    };
  }

  function renderQuoteHistory(quotes) {
    if (!quotes.length) return;
    const section = document.getElementById("quote-history");
    section.hidden = false;
    const list = document.getElementById("quote-history-list");
    list.replaceChildren();
    quotes.forEach((quote) => {
      const row = document.createElement("div");
      row.className = "quote-history-row";
      [
        `Version ${displayValue(quote.version)}`,
        currency(quote.total_amount),
        displayValue(quote.status),
        formatDate(quote.created_at)
      ].forEach((value) => {
        const cell = document.createElement("span");
        cell.textContent = value;
        row.appendChild(cell);
      });
      list.appendChild(row);
    });
  }

  async function loadExistingQuotes() {
    const result = await supabase
      .from("quotes")
      .select("*")
      .eq("booking_id", bookingDetailId)
      .order("version", { ascending: false });
    if (result.error) throw result.error;
    const quotes = result.data || [];
    renderQuoteHistory(quotes);
    if (!quotes.length) return false;
    const latestQuote = quotes[0];
    const lineItemsResult = await supabase
      .from("quote_line_items")
      .select("*")
      .eq("quote_id", latestQuote.id)
      .order("sort_order", { ascending: true });
    if (lineItemsResult.error) throw lineItemsResult.error;
    renderExistingQuote(latestQuote, lineItemsResult.data || []);
    renderCustomerQuoteAccess(latestQuote);
    return true;
  }

  function buildQuoteLineItems() {
    const calculation = calculateQuote();
    const eligibleSubtotal = calculateGratuityEligibleSubtotal();
    return calculation.calculated.map((item, index) => {
      const rule = item.rule;
      const customLabel = item.component.customLabel || quoteControlValue(item.component, "custom_label")?.value;
      const isGratuity = String(rule.code || "").toLowerCase() === "gratuity";
      const gratuityPercentage = isGratuity
        ? Math.max(0, quoteNumber(quoteControlValue(item.component, "percentage")?.value))
        : null;
      return {
        pricing_rule_id: rule.id,
        code: rule.code,
        label: customLabel || quoteRuleLabel(rule),
        calculation_type: rule.calculation_type,
        quantity: item.calculationType === "per_unit" ? item.quantity : 1,
        rate: item.rate,
        percentage: isGratuity ? gratuityPercentage : (item.calculationType === "percentage" ? item.percentage : null),
        amount: isGratuity ? eligibleSubtotal * (gratuityPercentage / 100) : item.amount,
        source: "manual",
        customer_visible: rule.customer_visible === true,
        taxable: rule.taxable === true,
        gratuity_eligible: rule.gratuity_eligible === true,
        estimated: item.calculationType === "auto",
        sort_order: index + 1,
        notes: item.calculationType === "auto" ? "Auto-capable / operator override" : null
      };
    });
  }

  async function createQuote() {
    const createButton = document.getElementById("create-quote");
    const baseFare = quotePricingRules.find((rule) => rule.code === "base_fare");
    const baseComponent = baseFare && quoteComponents.get(baseFare.id);
    const baseInput = baseComponent && quoteControlValue(baseComponent, "rate");
    if (!baseInput || baseInput.value.trim() === "" || quoteNumber(baseInput.value) < 0) {
      showQuoteBuilderError(new Error("Base Fare must be greater than or equal to 0."));
      return;
    }
    createButton.disabled = true;
    createButton.textContent = "Creating Quote...";
    document.getElementById("quote-builder-alert").hidden = true;
    try {
      const latestResult = await supabase
        .from("quotes")
        .select("version")
        .eq("booking_id", bookingDetailId)
        .order("version", { ascending: false })
        .limit(1);
      if (latestResult.error) throw latestResult.error;
      const latestVersion = latestResult.data?.[0]?.version;
      const version = latestVersion === null || latestVersion === undefined ? 1 : Number(latestVersion) + 1;
      const quoteTotal = refreshQuoteSummary().total;
      const quoteInsert = {
        booking_id: bookingDetailId,
        version,
        currency: "USD",
        total_amount: quoteTotal,
        customer_note: document.getElementById("quote-customer-note").value || null,
        internal_note: document.getElementById("quote-internal-note").value || null,
        valid_until: document.getElementById("quote-valid-until").value || null,
        created_by: currentAdminUserId
      };
      const quoteResult = await supabase.from("quotes").insert(quoteInsert).select("*").single();
      if (quoteResult.error) throw quoteResult.error;

      const lineItems = buildQuoteLineItems().map((item) => ({ ...item, quote_id: quoteResult.data.id }));
      const lineItemsResult = await supabase.from("quote_line_items").insert(lineItems).select("*");
      if (lineItemsResult.error) {
        const cleanupResult = await supabase
          .from("quotes")
          .delete()
          .eq("id", quoteResult.data.id);
        if (cleanupResult.error) {
          console.error("Quote cleanup error:", cleanupResult.error);
        }
        throw lineItemsResult.error;
      }

      const statusResult = await supabase
        .from("bookings")
        .update({ status: "quoted" })
        .eq("id", bookingDetailId)
        .eq("status", "reviewing")
        .select("id, status")
        .maybeSingle();
      if (statusResult.error || !statusResult.data) {
        throw statusResult.error || new Error("Quote was saved, but the booking status could not be updated.");
      }
      bookingDetail.status = statusResult.data.status;
      setDetailStatus(bookingDetail.status);
      renderBookingActions(bookingDetail.status);
      document.getElementById("quote-builder").hidden = true;
      await loadExistingQuotes();
      setActionAlert("Quote created successfully.", "success");
    } catch (error) {
      showQuoteBuilderError(error);
    } finally {
      createButton.disabled = false;
      createButton.textContent = "Create Quote";
    }
  }

  async function setupQuoteBuilder() {
    if (!bookingDetail) return;
    document.getElementById("create-quote").addEventListener("click", createQuote);
    try {
      const hasExistingQuote = await loadExistingQuotes();
      if (bookingDetail.status !== "reviewing" || hasExistingQuote) {
        document.getElementById("quote-builder").hidden = true;
        return;
      }
      await loadQuotePricingRules();
    } catch (error) {
      showQuoteBuilderError(error);
    }
  }

  async function updateBookingStatus(nextStatus) {
    if (!bookingDetail || !bookingDetailId) return;
    const currentStatus = bookingDetail.status;
    const allowedTransitions = {
      new: ["reviewing", "cancelled"],
      reviewing: ["cancelled"],
      quoted: ["cancelled"],
      awaiting_payment: ["cancelled"],
      paid: ["cancelled"],
      confirmed: ["completed", "cancelled"]
    };
    if (!allowedTransitions[currentStatus]?.includes(nextStatus)) return;

    const buttons = document.querySelectorAll("#booking-actions button");
    buttons.forEach((button) => {
      button.disabled = true;
    });
    setActionAlert("Updating booking status...");

    try {
      const result = await supabase
        .from("bookings")
        .update({ status: nextStatus })
        .eq("id", bookingDetailId)
        .select("id, status")
        .maybeSingle();
      if (result.error || !result.data) {
        throw result.error || new Error("No booking row was updated.");
      }

      bookingDetail.status = result.data.status;
      setDetailStatus(bookingDetail.status);
      renderBookingActions(bookingDetail.status);

      if (bookingDetail.status === "reviewing") {
        try {
          await loadQuotePricingRules();
        } catch (quoteError) {
          console.error("Quote pricing rules failed to load:", quoteError);
          showQuoteBuilderError(quoteError);
        }
      }
      setActionAlert("Booking status updated successfully.", "success");
    } catch (error) {
      console.error("Booking status update error:", error);
      setActionAlert("Booking status could not be updated.", "error");
      renderBookingActions(currentStatus);
    }
  }

  function renderStops(stops) {
    const stopsList = document.getElementById("stops-list");
    stopsList.replaceChildren();
    if (!stops.length) {
      stopsList.textContent = "No additional stops.";
      return;
    }

    stops.forEach((stop, index) => {
      const item = document.createElement("div");
      item.className = "stop-item";
      const number = document.createElement("span");
      number.className = "stop-number";
      number.textContent = `${String(stop.leg || "stop").toUpperCase()} ${stop.stop_order || index + 1}`;
      const address = document.createElement("span");
      address.textContent = displayValue(stop.address);
      item.append(number, address);
      stopsList.appendChild(item);
    });
  }

  function renderBookingDetail(booking, stops) {
    bookingDetail = booking;
    const customer = booking.customer || {};
    setDetailValue("detail-request-code", booking.request_code);
    setDetailValue("summary-request-code", booking.request_code);
    setDetailStatus(booking.status);
    renderBookingActions(booking.status);

    setDetailValue("first-name", booking.first_name || customer.first_name);
    setDetailValue("last-name", booking.last_name || customer.last_name);
    setDetailValue("email", booking.email || customer.email);
    setDetailValue("phone", booking.phone_e164 || booking.phone || customer.phone);
    setDetailValue("phone-dial-code", booking.phone_dial_code || customer.phone_dial_code);
    setDetailValue(
      "sms-consent",
      typeof booking.consent_transactional === "boolean"
        ? (booking.consent_transactional ? "Yes" : "No")
        : null
    );

    setDetailValue("trip-type", booking.trip_type);
    setDetailValue("pickup-date", booking.pickup_date);
    setDetailValue("pickup-time", booking.pickup_time);
    setDetailValue("hourly-hours", booking.hourly_hours);
    document.getElementById("hourly-hours-field").hidden = booking.trip_type !== "hourly";

    setDetailValue("pickup-type", booking.pickup_type);
    setDetailValue("pickup-location", booking.pickup_address);
    setDetailValue("dropoff-type", booking.dropoff_type);
    setDetailValue("dropoff-location", booking.dropoff_address);
    setDetailValue("distance", formatMeasure(booking.distance_miles, "miles"));
    setDetailValue("drive-time", formatMeasure(booking.estimated_duration_minutes, "minutes"));

    const isRoundTrip = booking.trip_type === "round-trip";
    document.getElementById("round-trip-section").hidden = !isRoundTrip;
    if (isRoundTrip) {
      setDetailValue("return-date", booking.return_date);
      setDetailValue("return-time", booking.return_time);
      setDetailValue("return-pickup-type", booking.return_pickup_type);
      setDetailValue("return-pickup-location", booking.return_pickup_address);
      setDetailValue("return-dropoff-type", booking.return_dropoff_type);
      setDetailValue("return-dropoff-location", booking.return_dropoff_address);
    }

    renderStops(stops);
    setDetailValue("passengers", booking.passengers);
    setDetailValue("luggage", booking.luggage);
    setDetailValue("flight-number", booking.flight_number);
    setDetailValue("trip-notes", booking.trip_notes);
    setDetailValue("vehicle", booking.preferred_vehicle_code);
    setDetailValue("created-at", formatDate(booking.created_at));
    setDetailValue("updated-at", formatDate(booking.updated_at));
    setDetailValue("request-reference", booking.request_code);
  }

  function showBookingError() {
    document.getElementById("booking-loading").hidden = true;
    document.getElementById("booking-content").hidden = true;
    document.getElementById("booking-error").hidden = false;
  }

  async function loadBookingDetail() {
    const bookingId = new URLSearchParams(
      window.location.search
    ).get("id");

    if (!bookingId) {
      showBookingError();
      return;
    }

    bookingDetailId = bookingId;

    try {
      const bookingQuery = supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();

      const stopsQuery = supabase
        .from("booking_stops")
        .select(
          "booking_id, leg, stop_order, address, place_id, lat, lng"
        )
        .eq("booking_id", bookingId)
        .order("leg", { ascending: true })
        .order("stop_order", { ascending: true });

      const [bookingResult, stopsResult] =
        await Promise.all([
          bookingQuery,
          stopsQuery
        ]);

      if (
        bookingResult.error ||
        !bookingResult.data
      ) {
        throw (
          bookingResult.error ||
          new Error("Booking was not found.")
        );
      }

      if (stopsResult.error) {
        throw stopsResult.error;
      }

      renderBookingDetail(
        bookingResult.data,
        stopsResult.data || []
      );

      document.getElementById(
        "booking-loading"
      ).hidden = true;

      document.getElementById(
        "booking-content"
      ).hidden = false;

    } catch (error) {

      console.error(
        "Unable to load booking detail:",
        error
      );

      showBookingError();
    }
  }

  function parseRuleMetadata(rule) {
    if (!rule.metadata) return {};
    if (typeof rule.metadata === "object") return rule.metadata;
    try {
      return JSON.parse(rule.metadata);
    } catch {
      return {};
    }
  }

  function pricingAlert(message, type = "error") {
    const alertElement = document.getElementById("pricing-alert");
    alertElement.textContent = message;
    alertElement.className = `dashboard-alert${type ? ` ${type}-alert` : ""}`;
    alertElement.hidden = false;
  }

  function pricingDisplayValue(value) {
    return value === null || value === undefined || String(value).trim() === "" ? "â€”" : String(value);
  }

  function createToggle(label, field, value) {
    const wrapper = document.createElement("label");
    wrapper.className = "toggle-field";
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.field = field;
    input.checked = value === true;
    wrapper.append(text, input);
    return wrapper;
  }

  function markPricingRuleDirty(card) {
    const saveButton = card.querySelector(".rule-save-button");
    const dirtyBadge = card.querySelector(".unsaved-badge");
    card.classList.add("is-dirty");
    saveButton.disabled = false;
    dirtyBadge.hidden = false;
  }

  function createPricingRuleCard(rule) {
    const metadata = parseRuleMetadata(rule);
    const card = document.createElement("article");
    card.className = "pricing-rule-card operator-pricing-card";
    card.dataset.ruleId = rule.id;

    const header = document.createElement("div");
    header.className = "pricing-rule-header";
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = pricingDisplayValue(rule.label);
    titleWrap.append(title);
    const enabledToggle = createToggle("Enabled", "enabled", rule.enabled);
    enabledToggle.classList.add("operator-enabled-toggle");
    header.append(titleWrap, enabledToggle);
    card.appendChild(header);

    const specialCodes = ["tax", "ny_congestion_surcharge", "black_car_fund", "credit_card_service_fee"];
    const ruleCode = String(rule.code || "").toLowerCase();
    const calculationType = String(rule.calculation_type || "").toLowerCase();
    const isGratuity = ruleCode === "gratuity";
    const isTolls = ruleCode === "tolls" || ruleCode === "toll" || ruleCode.includes("toll");
    const isDiscount = ruleCode.includes("discount");
    const isCustom = ruleCode === "custom_charge";
    const isAdvanced = specialCodes.includes(ruleCode);

    const body = document.createElement("div");
    body.className = "operator-pricing-body";
    if (isGratuity) {
      const options = document.createElement("p");
      options.className = "operator-note operator-options";
      options.textContent = "Suggested Options: 15%   16%   20%   Custom";
      body.appendChild(options);
      const note = document.createElement("p");
      note.className = "operator-note";
      note.textContent = "The operator chooses the gratuity while preparing each quote.";
      body.appendChild(note);
    } else if (isTolls) {
      const note = document.createElement("p");
      note.className = "operator-note";
      note.textContent = "Toll amount is entered or estimated when creating the quote.";
      body.appendChild(note);
    } else if (isDiscount) {
      const note = document.createElement("p");
      note.className = "operator-note";
      note.textContent = "Discount can be added during quote creation.";
      body.appendChild(note);
    } else if (isCustom) {
      const note = document.createElement("p");
      note.className = "operator-note";
      note.textContent = "Allows the operator to add a custom named charge while creating the quote.";
      body.appendChild(note);
    } else {
      const priceRow = document.createElement("div");
      priceRow.className = "operator-price-row";
      const priceField = document.createElement("label");
      priceField.className = "operator-price-field";
      const priceLabel = document.createElement("span");
      if (calculationType === "percentage") {
        priceLabel.textContent = "Default Percentage";
      } else if (calculationType === "per_unit") {
        const lowerLabel = ruleCode.includes("seat") ? "Price per seat" : ruleCode.includes("stop") ? "Price per stop" : "Price per interval";
        priceLabel.textContent = lowerLabel;
      } else {
        priceLabel.textContent = "Default Price / Rate";
      }
      const valueWrap = document.createElement("div");
      valueWrap.className = "operator-value-wrap";
      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.min = "0";
      valueInput.step = "0.01";
      valueInput.dataset.field = "default_value";
      valueInput.value = rule.default_value ?? "";
      const context = document.createElement("span");
      context.textContent = calculationType === "percentage" ? "%" : "USD";
      valueWrap.append(valueInput, context);
      priceField.append(priceLabel, valueWrap);
      priceRow.appendChild(priceField);
      body.appendChild(priceRow);
    }
    card.appendChild(body);

    if (isAdvanced && metadata.requires_configuration === true) {
      const warning = document.createElement("span");
      warning.className = "config-warning";
      warning.textContent = "Requires configuration";
      body.appendChild(warning);
    }

    const footer = document.createElement("div");
    footer.className = "pricing-rule-footer";
    const note = document.createElement("p");
    note.className = "rule-note";
    note.textContent = "Changes apply to future quotes.";
    const badges = document.createElement("div");
    badges.className = "pricing-rule-badges";
    const dirtyBadge = document.createElement("span");
    dirtyBadge.className = "unsaved-badge";
    dirtyBadge.textContent = "Unsaved changes";
    dirtyBadge.hidden = true;
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "rule-save-button";
    saveButton.textContent = "Save";
    saveButton.disabled = true;
    badges.append(dirtyBadge, saveButton);
    footer.append(note, badges);
    card.appendChild(footer);

    card.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => markPricingRuleDirty(card));
      input.addEventListener("change", () => markPricingRuleDirty(card));
    });
    saveButton.addEventListener("click", () => savePricingRule(card, rule));
    return card;
  }

  function renderPricingRules() {
    const container = document.getElementById("pricing-rules");
    container.replaceChildren();
    const groupedRules = new Map();
    const advancedCodes = new Set(["tax", "ny_congestion_surcharge", "black_car_fund", "credit_card_service_fee"]);
    const groupForRule = (rule) => {
      const code = String(rule.code || "").toLowerCase();
      if (advancedCodes.has(code)) return "Advanced & Regulatory";
      if (code.includes("seat") || code.includes("booster") || code.includes("child")) return "Child Seats";
      if (code.includes("airport") || code.includes("meet") || code.includes("parking")) return "Airport Services";
      if (code.includes("discount") || code.includes("gratuity") || code.includes("service_charge")) return "Adjustments";
      if (code.includes("stop") || code.includes("wait") || code.includes("toll") || code.includes("vehicle")) return "Trip Charges";
      if (code === "base_fare") return "Core Pricing";
      return "Core Pricing";
    };
    pricingRules.forEach((rule) => {
      const category = groupForRule(rule);
      if (!groupedRules.has(category)) groupedRules.set(category, []);
      groupedRules.get(category).push(rule);
    });
    groupedRules.forEach((rules, category) => {
      const group = document.createElement("section");
      group.className = "pricing-group";
      const heading = document.createElement("h2");
      heading.textContent = category;
      const count = document.createElement("span");
      count.className = "pricing-group-count";
      count.textContent = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
      heading.appendChild(count);
      const list = document.createElement("div");
      list.className = "pricing-rule-list";
      rules.forEach((rule) => list.appendChild(createPricingRuleCard(rule)));
      group.append(heading, list);
      container.appendChild(group);
    });
    container.hidden = false;
  }

  async function savePricingRule(card, rule) {
    const saveButton = card.querySelector(".rule-save-button");
    const defaultInput = card.querySelector('[data-field="default_value"]');
    const payload = {
      enabled: card.querySelector('[data-field="enabled"]').checked
    };
    if (defaultInput) {
      payload.default_value = defaultInput.value === "" ? null : Number(defaultInput.value);
    }
    saveButton.disabled = true;
    saveButton.textContent = "Saving...";
    try {
      const result = await supabase
        .from("pricing_rules")
        .update(payload)
        .eq("id", rule.id)
        .select("*")
        .single();
      if (result.error) throw result.error;
      Object.assign(rule, result.data);
      card.classList.remove("is-dirty");
      card.querySelector(".unsaved-badge").hidden = true;
      pricingAlert("Pricing setting saved.", "success");
    } catch (error) {
      console.error("Pricing rule update error:", error);
      pricingAlert(error.message || "Pricing rule could not be updated.", "error");
      saveButton.disabled = false;
    } finally {
      saveButton.textContent = "Save";
    }
  }

  async function loadPricingRules() {
    const refreshButton = document.getElementById("refresh-pricing");
    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    document.getElementById("pricing-loading").hidden = false;
    document.getElementById("pricing-rules").hidden = true;
    document.getElementById("pricing-alert").hidden = true;
    try {
      const result = await supabase
        .from("pricing_rules")
        .select("*")
        .order("sort_order", { ascending: true });
      if (result.error) throw result.error;
      pricingRules = result.data || [];
      if (!pricingRules.length) {
        pricingAlert("No pricing rules found.", "error");
        return;
      }
      renderPricingRules();
    } catch (error) {
      console.error("Unable to load pricing rules:", error);
      pricingAlert(error.message || "Pricing rules could not be loaded.", "error");
    } finally {
      document.getElementById("pricing-loading").hidden = true;
      refreshButton.disabled = false;
      refreshButton.textContent = "Refresh Pricing";
    }
  }

  function setupPricing() {
    document.getElementById("refresh-pricing").addEventListener("click", () => {
      const hasUnsavedChanges = document.querySelector(".pricing-rule-card.is-dirty");
      if (hasUnsavedChanges && !window.confirm("Discard unsaved pricing changes and refresh?")) return;
      loadPricingRules();
    });
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearError();

    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const submitButton = form.querySelector("button[type=submit]");

    if (!email || !password) {
      showError("Enter your email address and password.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Signing In...";

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      const userId = data.user?.id;
      if (!userId) throw new Error("Authentication did not return a user.");

      const profile = await getActiveAdminProfile(userId);
      if (!profile) {
        await supabase.auth.signOut();
        showError("You do not have permission to access the admin portal.");
        return;
      }

      window.location.replace("dashboard.html");
    } catch (error) {
      showError(error.message || "Unable to sign in. Please try again.");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Sign In";
    }
  }

  async function protectDashboard() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      window.location.replace("login.html");
      return;
    }

    try {
      const profile = await getActiveAdminProfile(data.session.user.id);
      if (!profile) {
        await signOutAndRedirect();
        return;
      }

      const welcomeMessage = document.getElementById("welcome-message");
      welcomeMessage.textContent = `Welcome, ${profile.full_name || "Admin"}`;
      setupBookingControls();
      await loadBookings();
    } catch {
      await signOutAndRedirect();
    }
  }

  function setupSignOut() {
    document.getElementById("sign-out").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      await signOutAndRedirect();
    });
  }

  if (page === "login") {
    document.getElementById("login-form").addEventListener("submit", handleLogin);
  }

  if (page === "dashboard") {
    setupSignOut();
    protectDashboard();
  }

  async function protectBooking() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      window.location.replace("login.html");
      return;
    }

    try {
      const profile = await getActiveAdminProfile(data.session.user.id);
      if (!profile) {
        await signOutAndRedirect();
        return;
      }
      currentAdminUserId = data.session.user.id;
      await loadBookingDetail();
      await setupQuoteBuilder();
    } catch {
      await signOutAndRedirect();
    }
  }

  if (page === "booking") {
    setupSignOut();
    protectBooking();
  }

  async function protectPricing() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      window.location.replace("login.html");
      return;
    }

    try {
      const profile = await getActiveAdminProfile(data.session.user.id);
      if (!profile) {
        await signOutAndRedirect();
        return;
      }
      setupPricing();
      await loadPricingRules();
    } catch {
      await signOutAndRedirect();
    }
  }

  if (page === "pricing") {
    setupSignOut();
    protectPricing();
  }
})();

