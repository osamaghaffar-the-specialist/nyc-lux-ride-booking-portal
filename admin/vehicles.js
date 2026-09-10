(() => {
  "use strict";

  const config = window.NYC_LUX_RIDE_BACKEND_CONFIG;
  const supabaseLibrary = window.supabase;

  if (!config || !supabaseLibrary) {
    alert("Vehicle Management could not connect to Supabase.");
    return;
  }

  const supabase = supabaseLibrary.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );

  const BUCKET = "vehicle-images";
  const MAX_PHOTOS = 3;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const MIN_WIDTH = 800;
  const MIN_HEIGHT = 600;
  const REQUIRED_RATIO = 4 / 3;

  let vehicles = [];
  let featureCatalog = [];
  let editingVehicle = null;

  /*
  ============================================================
  PHOTO STATE

  Each item:
  {
    id,
    image_url,
    storage_path,
    sort_order,
    is_featured,
    file,
    previewUrl,
    isNew
  }
  ============================================================
  */

  let photoState = [];
  let originalPhotoState = [];
  let draggedPhotoIndex = null;


  /*
  ============================================================
  BASIC HELPERS
  ============================================================
  */

  function byId(id) {
    return document.getElementById(id);
  }

  function nullableText(value) {
    const text = String(value ?? "").trim();
    return text || null;
  }

  function nullableNumber(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function setValue(id, value) {
    const element = byId(id);
    if (!element) return;
    element.value = value ?? "";
  }

  function setChecked(id, value) {
    const element = byId(id);
    if (!element) return;
    element.checked = Boolean(value);
  }

  function showAlert(message, type = "error") {
    const alert = byId("vehicle-alert");

    alert.textContent = message;
    alert.className =
      `dashboard-alert ${type === "success" ? "vehicle-success" : "vehicle-error"}`;

    alert.hidden = false;

    alert.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });

    if (type === "success") {
      window.setTimeout(() => {
        alert.hidden = true;
      }, 4500);
    }
  }

  function hideAlert() {
    const alert = byId("vehicle-alert");
    alert.hidden = true;
    alert.textContent = "";
  }

  function showPhotoError(message) {
    const errorBox = byId("vehicle-photo-error");

    if (!errorBox) return;

    errorBox.textContent = message;
    errorBox.hidden = false;

    errorBox.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  function hidePhotoError() {
    const errorBox = byId("vehicle-photo-error");

    if (!errorBox) return;

    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  function validateCode(code) {
    return /^[a-z0-9_-]+$/.test(code);
  }

  function getDisplayImage(vehicle) {
    return vehicle.image_url || null;
  }


  /*
  ============================================================
  AUTH
  ============================================================
  */

  async function getAdminProfile(userId) {
    const result = await supabase
      .from("admin_profiles")
      .select("id, full_name, active")
      .eq("id", userId)
      .eq("active", true)
      .maybeSingle();

    if (result.error) throw result.error;

    return result.data;
  }

  async function protectPage() {
    const sessionResult = await supabase.auth.getSession();

    if (
      sessionResult.error ||
      !sessionResult.data.session
    ) {
      window.location.replace("login.html");
      return false;
    }

    const profile = await getAdminProfile(
      sessionResult.data.session.user.id
    );

    if (!profile) {
      await supabase.auth.signOut();
      window.location.replace("login.html");
      return false;
    }

    return true;
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.replace("login.html");
  }


  /*
  ============================================================
  FEATURES
  ============================================================
  */

  async function loadFeatureCatalog() {
    const result = await supabase
      .from("vehicle_feature_catalog")
      .select("*")
      .eq("active", true)
      .order("display_order", { ascending: true });

    if (result.error) throw result.error;

    featureCatalog = result.data || [];

    renderFeatureCatalog();
  }

  function renderFeatureCatalog() {
    const containers = {
      general: byId("vehicle-features-general"),
      multimedia: byId("vehicle-features-multimedia"),
      policies: byId("vehicle-features-policies")
    };

    Object.values(containers).forEach(container => {
      container.replaceChildren();
    });

    featureCatalog.forEach(feature => {
      const container = containers[feature.category];

      if (!container) return;

      const label = document.createElement("label");
      label.className = "vehicle-feature-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = feature.code;
      checkbox.dataset.featureCode = feature.code;

      const span = document.createElement("span");
      span.textContent = feature.label;

      label.append(checkbox, span);
      container.appendChild(label);
    });
  }

  function selectedFeatureCodes() {
    return [
      ...document.querySelectorAll(
        '[data-feature-code]:checked'
      )
    ].map(input => input.value);
  }

  function clearFeatureSelection() {
    document
      .querySelectorAll("[data-feature-code]")
      .forEach(input => {
        input.checked = false;
      });
  }

  function applyFeatureSelection(featureCodes) {
    clearFeatureSelection();

    const selected = new Set(featureCodes || []);

    document
      .querySelectorAll("[data-feature-code]")
      .forEach(input => {
        input.checked = selected.has(input.value);
      });
  }


  /*
  ============================================================
  VEHICLE LIST
  ============================================================
  */

  async function loadVehicles() {
    const loading = byId("vehicle-loading");
    const wrap = byId("vehicle-table-wrap");
    const refresh = byId("refresh-vehicles");

    loading.hidden = false;
    wrap.hidden = true;

    refresh.disabled = true;
    refresh.textContent = "Refreshing...";

    try {
      const result = await supabase
        .from("vehicles")
        .select("*")
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });

      if (result.error) throw result.error;

      vehicles = result.data || [];

      renderVehicleTable();
    } catch (error) {
      console.error("Vehicle load error:", error);

      showAlert(
        error.message || "Vehicles could not be loaded."
      );
    } finally {
      loading.hidden = true;
      wrap.hidden = false;

      refresh.disabled = false;
      refresh.textContent = "Refresh";
    }
  }

  function filteredVehicles() {
    const query = byId("vehicle-search")
      .value
      .trim()
      .toLowerCase();

    const status =
      byId("vehicle-status-filter").value;

    return vehicles.filter(vehicle => {
      const searchable = [
        vehicle.name,
        vehicle.code,
        vehicle.category,
        vehicle.make,
        vehicle.model,
        vehicle.vin_number,
        vehicle.license_plate_number
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        query &&
        !searchable.includes(query)
      ) {
        return false;
      }

      if (
        status === "active" &&
        !vehicle.active
      ) {
        return false;
      }

      if (
        status === "inactive" &&
        vehicle.active
      ) {
        return false;
      }

      if (
        status === "portal" &&
        !vehicle.display_on_customer_portal
      ) {
        return false;
      }

      return true;
    });
  }

  function renderVehicleTable() {
    const body = byId("vehicle-table-body");
    const list = filteredVehicles();

    body.replaceChildren();

    byId("vehicle-count").textContent =
      `${list.length} ${list.length === 1 ? "vehicle" : "vehicles"}`;

    if (!list.length) {
      const row = document.createElement("tr");

      const cell = document.createElement("td");
      cell.colSpan = 8;
      cell.style.textAlign = "center";
      cell.style.padding = "42px";
      cell.textContent = "No matching vehicles found.";

      row.appendChild(cell);
      body.appendChild(row);

      return;
    }

    list.forEach(vehicle => {
      body.appendChild(createVehicleRow(vehicle));
    });
  }

  function createVehicleRow(vehicle) {
    const row = document.createElement("tr");

    /*
    VEHICLE
    */

    const vehicleCell = document.createElement("td");

    const vehicleWrap =
      document.createElement("div");

    vehicleWrap.className =
      "vehicle-directory-vehicle";

    const imageUrl = getDisplayImage(vehicle);

    if (imageUrl) {
      const image = document.createElement("img");

      image.className =
        "vehicle-directory-image";

      image.src = imageUrl;
      image.alt = vehicle.name;

      vehicleWrap.appendChild(image);
    } else {
      const placeholder =
        document.createElement("div");

      placeholder.className =
        "vehicle-directory-placeholder";

      placeholder.textContent = "NO PHOTO";

      vehicleWrap.appendChild(placeholder);
    }

    const text =
      document.createElement("div");

    text.className =
      "vehicle-directory-name";

    const strong =
      document.createElement("strong");

    strong.textContent = vehicle.name;

    const small =
      document.createElement("small");

    small.textContent =
      vehicle.code || "-";

    text.append(strong, small);

    vehicleWrap.appendChild(text);
    vehicleCell.appendChild(vehicleWrap);


    /*
    CATEGORY
    */

    const categoryCell =
      document.createElement("td");

    categoryCell.textContent =
      vehicle.category || "-";


    /*
    PASSENGERS
    */

    const passengerCell =
      document.createElement("td");

    passengerCell.textContent =
      vehicle.passenger_capacity ?? "-";


    /*
    LUGGAGE
    */

    const luggageCell =
      document.createElement("td");

    luggageCell.textContent =
      vehicle.luggage_capacity ?? "-";


    /*
    PLATE
    */

    const plateCell =
      document.createElement("td");

    plateCell.textContent =
      vehicle.license_plate_number || "-";


    /*
    PORTAL
    */

    const portalCell =
      document.createElement("td");

    const portalBadge =
      document.createElement("span");

    portalBadge.className =
      `vehicle-portal-badge ${
        vehicle.display_on_customer_portal
          ? "is-visible"
          : "is-hidden"
      }`;

    portalBadge.textContent =
      vehicle.display_on_customer_portal
        ? "Visible"
        : "Hidden";

    portalCell.appendChild(portalBadge);


    /*
    STATUS
    */

    const statusCell =
      document.createElement("td");

    const statusBadge =
      document.createElement("span");

    statusBadge.className =
      `vehicle-status-badge ${
        vehicle.active
          ? "is-active"
          : "is-inactive"
      }`;

    statusBadge.textContent =
      vehicle.active
        ? "Active"
        : "Inactive";

    statusCell.appendChild(statusBadge);


    /*
    EDIT
    */

    const actionCell =
      document.createElement("td");

    const edit =
      document.createElement("button");

    edit.type = "button";
    edit.className = "vehicle-edit-button";
    edit.textContent = "Edit";

    edit.addEventListener(
      "click",
      () => openEditVehicle(vehicle.id)
    );

    actionCell.appendChild(edit);

    row.append(
      vehicleCell,
      categoryCell,
      passengerCell,
      luggageCell,
      plateCell,
      portalCell,
      statusCell,
      actionCell
    );

    return row;
  }


  /*
  ============================================================
  DRAWER
  ============================================================
  */

  function openDrawer() {
    byId("vehicle-drawer-backdrop").hidden = false;

    byId("vehicle-drawer").classList.add("is-open");

    byId("vehicle-drawer").setAttribute(
      "aria-hidden",
      "false"
    );

    document.body.classList.add(
      "vehicle-drawer-open"
    );
  }

  function closeDrawer() {
    byId("vehicle-drawer").classList.remove("is-open");

    byId("vehicle-drawer").setAttribute(
      "aria-hidden",
      "true"
    );

    byId("vehicle-drawer-backdrop").hidden = true;

    document.body.classList.remove(
      "vehicle-drawer-open"
    );

    revokePendingPreviewUrls();

    editingVehicle = null;
    photoState = [];
    originalPhotoState = [];
  }


  /*
  ============================================================
  ADD VEHICLE
  ============================================================
  */

  function openAddVehicle() {
    editingVehicle = null;

    byId("vehicle-form").reset();

    byId("vehicle-id").value = "";

    byId("vehicle-drawer-mode").textContent =
      "New Fleet Vehicle";

    byId("vehicle-drawer-title").textContent =
      "Add New Vehicle";

    byId("save-vehicle").textContent =
      "Save Vehicle";

    byId("vehicle-code").disabled = false;

    setChecked("vehicle-active", true);

    setChecked(
      "vehicle-display-portal",
      true
    );

    setChecked(
      "pricing-base-rate-automation",
      false
    );

    setChecked(
      "pricing-customer-portal",
      false
    );

    setValue("vehicle-display-order", 0);

    clearFeatureSelection();

    photoState = [];
    originalPhotoState = [];

    renderPhotoSlots();

    openDrawer();

    window.setTimeout(() => {
      byId("vehicle-name").focus();
    }, 250);
  }


  /*
  ============================================================
  EDIT VEHICLE
  ============================================================
  */

  async function openEditVehicle(vehicleId) {
    hideAlert();

    const vehicle =
      vehicles.find(item => item.id === vehicleId);

    if (!vehicle) return;

    editingVehicle = vehicle;

    byId("vehicle-drawer-mode").textContent =
      "Edit Fleet Vehicle";

    byId("vehicle-drawer-title").textContent =
      vehicle.name;

    byId("save-vehicle").textContent =
      "Save Changes";

    populateVehicleFields(vehicle);

    try {
      await Promise.all([
        loadVehiclePhotos(vehicle.id),
        loadVehicleFeatures(vehicle.id),
        loadVehiclePricing(vehicle.id)
      ]);

      openDrawer();
    } catch (error) {
      console.error(
        "Vehicle editor load error:",
        error
      );

      showAlert(
        error.message ||
          "Some vehicle information could not be loaded."
      );
    }
  }

  function populateVehicleFields(vehicle) {
    setValue("vehicle-id", vehicle.id);

    setValue(
      "vehicle-name",
      vehicle.name
    );

    setValue(
      "vehicle-code",
      vehicle.code
    );

    /*
    We lock the code after creation because it
    is used as a stable internal identifier.
    */

    byId("vehicle-code").disabled = true;

    setValue(
      "vehicle-category",
      vehicle.category
    );

    setValue(
      "vehicle-make",
      vehicle.make
    );

    setValue(
      "vehicle-model",
      vehicle.model
    );

    setValue(
      "vehicle-model-year",
      vehicle.model_year
    );

    setValue(
      "vehicle-color",
      vehicle.exterior_color
    );

    setValue(
      "vehicle-vin",
      vehicle.vin_number
    );

    setValue(
      "vehicle-license-plate",
      vehicle.license_plate_number
    );

    setValue(
      "vehicle-passengers",
      vehicle.passenger_capacity
    );

    setValue(
      "vehicle-luggage",
      vehicle.luggage_capacity
    );

    setValue(
      "vehicle-display-order",
      vehicle.display_order
    );

    setValue(
      "vehicle-description",
      vehicle.description
    );

    setValue(
      "vehicle-custom-features",
      Array.isArray(vehicle.custom_features)
        ? vehicle.custom_features.join(", ")
        : ""
    );

    setValue(
      "vehicle-internal-notes",
      vehicle.internal_notes
    );

    setChecked(
      "vehicle-active",
      vehicle.active
    );

    setChecked(
      "vehicle-display-portal",
      vehicle.display_on_customer_portal
    );
  }


  /*
  ============================================================
  LOAD EDIT DATA
  ============================================================
  */

  async function loadVehicleFeatures(vehicleId) {
    const result = await supabase
      .from("vehicle_features")
      .select("feature_code")
      .eq("vehicle_id", vehicleId);

    if (result.error) throw result.error;

    applyFeatureSelection(
      (result.data || []).map(
        item => item.feature_code
      )
    );
  }

  async function loadVehiclePricing(vehicleId) {
    const result = await supabase
      .from("vehicle_pricing")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .maybeSingle();

    if (result.error) throw result.error;

    const pricing = result.data || {};

    setValue(
      "pricing-minimum-base",
      pricing.minimum_total_base_rate
    );

    setValue(
      "pricing-deadhead-mile",
      pricing.deadhead_rate_per_mile
    );

    setValue(
      "pricing-trip-mile",
      pricing.trip_rate_per_mile
    );

    setValue(
      "pricing-weekday-rate",
      pricing.weekday_hourly_rate
    );

    setValue(
      "pricing-weekday-minimum",
      pricing.weekday_hourly_minimum_hours
    );

    setValue(
      "pricing-weekend-rate",
      pricing.weekend_hourly_rate
    );

    setValue(
      "pricing-weekend-minimum",
      pricing.weekend_hourly_minimum_hours
    );

    setValue(
      "pricing-deadhead-duration",
      pricing.total_deadhead_duration_minutes
    );

    setChecked(
      "pricing-base-rate-automation",
      pricing.base_rate_automation
    );

    setChecked(
      "pricing-customer-portal",
      pricing.customer_portal_pricing
    );
  }

  async function loadVehiclePhotos(vehicleId) {
    const result = await supabase
      .from("vehicle_photos")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("sort_order", { ascending: true });

    if (result.error) throw result.error;

    photoState = (result.data || []).map(photo => ({
      ...photo,
      file: null,
      previewUrl: null,
      isNew: false
    }));

    ensureFeaturedPhotoFirst();

    originalPhotoState =
      photoState.map(photo => ({ ...photo }));

    renderPhotoSlots();
  }


  /*
  ============================================================
  PHOTO VALIDATION
  ============================================================
  */

  function validateImageFile(file) {
    if (!file) {
      throw new Error("Select an image first.");
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
      throw new Error(
        "Only JPG, PNG and WEBP images are allowed."
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        "Vehicle images must be 5 MB or less."
      );
    }
  }

  function readImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        const dimensions = {
          width: image.naturalWidth,
          height: image.naturalHeight
        };

        URL.revokeObjectURL(url);
        resolve(dimensions);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);

        reject(
          new Error(
            "The selected image could not be read."
          )
        );
      };

      image.src = url;
    });
  }

  async function validateImageDimensions(file) {
    validateImageFile(file);

    const dimensions =
      await readImageDimensions(file);

    if (
      dimensions.width < MIN_WIDTH ||
      dimensions.height < MIN_HEIGHT
    ) {
      throw new Error(
        `Image must be at least ${MIN_WIDTH} x ${MIN_HEIGHT} pixels.`
      );
    }

    const ratio =
      dimensions.width / dimensions.height;

    /*
    Small tolerance handles images that are
    off by a few pixels due to export/cropping.
    */

    if (
      Math.abs(ratio - REQUIRED_RATIO) > 0.02
    ) {
      throw new Error(
        "Vehicle photos must use a 4:3 aspect ratio. Recommended size: 1600 x 1200 pixels."
      );
    }

    return dimensions;
  }


  /*
  ============================================================
  PHOTO STATE UI
  ============================================================
  */

  function createPendingPhoto(file, previewUrl) {
    return {
      id: null,
      image_url: null,
      storage_path: null,
      sort_order: photoState.length + 1,
      is_featured: photoState.length === 0,
      file,
      previewUrl,
      isNew: true
    };
  }

  async function handlePhotoInput(event) {
    const input = event.currentTarget;

    const slotIndex =
      Number(input.dataset.photoInput) - 1;

    const file = input.files?.[0];

    if (!file) return;

    try {
      hidePhotoError();

      await validateImageDimensions(file);

      const previewUrl =
        URL.createObjectURL(file);

      const existing =
        photoState[slotIndex];

      if (
        existing?.isNew &&
        existing.previewUrl
      ) {
        URL.revokeObjectURL(
          existing.previewUrl
        );
      }

      const pending =
        createPendingPhoto(
          file,
          previewUrl
        );

      /*
      Preserve featured status when replacing
      an existing photo.
      */

      if (existing?.is_featured) {
        pending.is_featured = true;
      }

      photoState[slotIndex] = pending;

      photoState =
        photoState.filter(Boolean);

      normalizePhotoState();

      renderPhotoSlots();

    } catch (error) {
      input.value = "";

      showPhotoError(
        error.message ||
          "Photo could not be added."
      );
    }
  }

  function removePhotoAt(index) {
    const photo = photoState[index];

    if (!photo) return;

    if (
      photo.isNew &&
      photo.previewUrl
    ) {
      URL.revokeObjectURL(
        photo.previewUrl
      );
    }

    const wasFeatured =
      photo.is_featured;

    photoState.splice(index, 1);

    if (
      wasFeatured &&
      photoState.length
    ) {
      photoState[0].is_featured = true;
    }

    normalizePhotoState();
    renderPhotoSlots();
  }

  function featurePhotoAt(index) {
    if (!photoState[index]) return;

    photoState.forEach(photo => {
      photo.is_featured = false;
    });

    photoState[index].is_featured = true;

    /*
    Featured photo always becomes first.
    */

    const featured =
      photoState.splice(index, 1)[0];

    photoState.unshift(featured);

    normalizePhotoState();
    renderPhotoSlots();
  }

  function normalizePhotoState() {
    photoState.forEach((photo, index) => {
      photo.sort_order = index + 1;
    });

    if (
      photoState.length &&
      !photoState.some(
        photo => photo.is_featured
      )
    ) {
      photoState[0].is_featured = true;
    }

    ensureFeaturedPhotoFirst();
  }

  function ensureFeaturedPhotoFirst() {
    const featuredIndex =
      photoState.findIndex(
        photo => photo.is_featured
      );

    if (featuredIndex > 0) {
      const featured =
        photoState.splice(
          featuredIndex,
          1
        )[0];

      photoState.unshift(featured);
    }

    photoState.forEach(
      (photo, index) => {
        photo.sort_order = index + 1;
      }
    );
  }

  function renderPhotoSlots() {
    const slots = [
      ...document.querySelectorAll(
        ".vehicle-photo-slot"
      )
    ];

    slots.forEach((slot, index) => {
      const photo = photoState[index];

      const image =
        slot.querySelector(
          ".vehicle-photo-image"
        );

      const placeholder =
        slot.querySelector(
          ".vehicle-photo-placeholder"
        );

      const featureButton =
        slot.querySelector(
          '[data-action="feature-photo"]'
        );

      const removeButton =
        slot.querySelector(
          '[data-action="remove-photo"]'
        );

      const input =
        slot.querySelector(
          "[data-photo-input]"
        );

      input.value = "";

      if (!photo) {
        image.hidden = true;
        image.removeAttribute("src");

        placeholder.hidden = false;

        featureButton.hidden = true;
        removeButton.hidden = true;

        slot.draggable = false;

        return;
      }

      const source =
        photo.previewUrl ||
        photo.image_url;

      image.src = source;
      image.alt =
        editingVehicle?.name ||
        byId("vehicle-name").value ||
        "Vehicle photo";

      image.hidden = false;
      placeholder.hidden = true;

      featureButton.hidden = false;
      removeButton.hidden = false;

      featureButton.textContent =
        photo.is_featured
          ? "FEATURED"
          : "SET FEATURED";
      featureButton.classList.toggle(
        "is-featured",
        Boolean(photo.is_featured)
      );

      slot.draggable = true;
    });
  }

  function revokePendingPreviewUrls() {
    photoState.forEach(photo => {
      if (
        photo.isNew &&
        photo.previewUrl
      ) {
        URL.revokeObjectURL(
          photo.previewUrl
        );
      }
    });
  }


  /*
  ============================================================
  DRAG / REARRANGE PHOTOS
  ============================================================
  */

  function setupPhotoDragAndDrop() {
    const slots = [
      ...document.querySelectorAll(
        ".vehicle-photo-slot"
      )
    ];

    slots.forEach(slot => {
      slot.addEventListener(
        "dragstart",
        event => {
          const index =
            Number(
              slot.dataset.photoPosition
            ) - 1;

          if (!photoState[index]) {
            event.preventDefault();
            return;
          }

          draggedPhotoIndex = index;

          slot.classList.add(
            "is-dragging"
          );

          event.dataTransfer.effectAllowed =
            "move";
        }
      );

      slot.addEventListener(
        "dragend",
        () => {
          draggedPhotoIndex = null;

          slots.forEach(item => {
            item.classList.remove(
              "is-dragging",
              "is-drag-over"
            );
          });
        }
      );

      slot.addEventListener(
        "dragover",
        event => {
          if (
            draggedPhotoIndex === null
          ) {
            return;
          }

          event.preventDefault();

          slot.classList.add(
            "is-drag-over"
          );
        }
      );

      slot.addEventListener(
        "dragleave",
        () => {
          slot.classList.remove(
            "is-drag-over"
          );
        }
      );

      slot.addEventListener(
        "drop",
        event => {
          event.preventDefault();

          slot.classList.remove(
            "is-drag-over"
          );

          if (
            draggedPhotoIndex === null
          ) {
            return;
          }

          const targetIndex =
            Number(
              slot.dataset.photoPosition
            ) - 1;

          if (
            !photoState[targetIndex] ||
            targetIndex === draggedPhotoIndex
          ) {
            return;
          }

          const [moved] =
            photoState.splice(
              draggedPhotoIndex,
              1
            );

          photoState.splice(
            targetIndex,
            0,
            moved
          );

          /*
          If featured moved somewhere else,
          keep it featured but user ordering is
          allowed. Once they star a photo, it is
          brought back to first.
          */

          normalizePhotoState();

          renderPhotoSlots();
        }
      );
    });
  }


  /*
  ============================================================
  PHOTO STORAGE
  ============================================================
  */

  function extensionForFile(file) {
    if (file.type === "image/png") {
      return "png";
    }

    if (file.type === "image/webp") {
      return "webp";
    }

    return "jpg";
  }

  async function uploadPendingPhoto(
    photo,
    vehicleCode,
    index
  ) {
    if (!photo.file) return photo;

    const extension =
      extensionForFile(photo.file);

    const safeCode =
      String(vehicleCode)
        .toLowerCase()
        .replace(
          /[^a-z0-9_-]/g,
          "-"
        );

    const path =
      `vehicles/${safeCode}/${Date.now()}-${index + 1}.${extension}`;

    const upload =
      await supabase.storage
        .from(BUCKET)
        .upload(
          path,
          photo.file,
          {
            cacheControl: "3600",
            upsert: false
          }
        );

    if (upload.error) {
      throw upload.error;
    }

    const publicUrl =
      supabase.storage
        .from(BUCKET)
        .getPublicUrl(path)
        .data
        .publicUrl;

    return {
      ...photo,
      storage_path: path,
      image_url: publicUrl,
      isNew: true
    };
  }

  async function removeStoragePaths(paths) {
    const cleanPaths =
      [...new Set(paths.filter(Boolean))];

    if (!cleanPaths.length) return;

    const result =
      await supabase.storage
        .from(BUCKET)
        .remove(cleanPaths);

    if (result.error) {
      console.warn(
        "Storage cleanup warning:",
        result.error
      );
    }
  }


  /*
  ============================================================
  VEHICLE PAYLOADS
  ============================================================
  */

  function vehiclePayload() {
    const name =
      byId("vehicle-name")
        .value
        .trim();

    const code =
      byId("vehicle-code")
        .value
        .trim()
        .toLowerCase();

    const category =
      byId("vehicle-category")
        .value
        .trim();

    const passengers =
      nullableNumber(
        byId("vehicle-passengers").value
      );

    if (!name) {
      throw new Error(
        "Vehicle name is required."
      );
    }

    if (!code) {
      throw new Error(
        "Vehicle code is required."
      );
    }

    if (!validateCode(code)) {
      throw new Error(
        "Vehicle code may only contain lowercase letters, numbers, underscores and hyphens."
      );
    }

    if (!category) {
      throw new Error(
        "Vehicle category is required."
      );
    }

    if (
      passengers === null ||
      passengers < 1
    ) {
      throw new Error(
        "Passenger capacity must be at least 1."
      );
    }

    const customFeatures =
      byId("vehicle-custom-features")
        .value
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);

    return {
      code,
      name,
      category,

      make:
        nullableText(
          byId("vehicle-make").value
        ),

      model:
        nullableText(
          byId("vehicle-model").value
        ),

      model_year:
        nullableNumber(
          byId("vehicle-model-year").value
        ),

      exterior_color:
        nullableText(
          byId("vehicle-color").value
        ),

      vin_number:
        nullableText(
          byId("vehicle-vin").value
        ),

      license_plate_number:
        nullableText(
          byId("vehicle-license-plate").value
        ),

      passenger_capacity:
        passengers,

      luggage_capacity:
        nullableNumber(
          byId("vehicle-luggage").value
        ),

      display_order:
        Number(
          byId("vehicle-display-order").value ||
          0
        ),

      description:
        nullableText(
          byId("vehicle-description").value
        ),

      custom_features:
        customFeatures,

      internal_notes:
        nullableText(
          byId("vehicle-internal-notes").value
        ),

      active:
        byId("vehicle-active").checked,

      display_on_customer_portal:
        byId(
          "vehicle-display-portal"
        ).checked
    };
  }

  function pricingPayload(vehicleId) {
    return {
      vehicle_id: vehicleId,

      minimum_total_base_rate:
        nullableNumber(
          byId("pricing-minimum-base").value
        ),

      deadhead_rate_per_mile:
        nullableNumber(
          byId("pricing-deadhead-mile").value
        ),

      trip_rate_per_mile:
        nullableNumber(
          byId("pricing-trip-mile").value
        ),

      weekday_hourly_rate:
        nullableNumber(
          byId("pricing-weekday-rate").value
        ),

      weekday_hourly_minimum_hours:
        nullableNumber(
          byId(
            "pricing-weekday-minimum"
          ).value
        ),

      weekend_hourly_rate:
        nullableNumber(
          byId("pricing-weekend-rate").value
        ),

      weekend_hourly_minimum_hours:
        nullableNumber(
          byId(
            "pricing-weekend-minimum"
          ).value
        ),

      total_deadhead_duration_minutes:
        nullableNumber(
          byId(
            "pricing-deadhead-duration"
          ).value
        ),

      base_rate_automation:
        byId(
          "pricing-base-rate-automation"
        ).checked,

      customer_portal_pricing:
        byId(
          "pricing-customer-portal"
        ).checked
    };
  }


  /*
  ============================================================
  SAVE FEATURES
  ============================================================
  */

  async function saveFeatures(vehicleId) {
    const remove = await supabase
      .from("vehicle_features")
      .delete()
      .eq("vehicle_id", vehicleId);

    if (remove.error) {
      throw remove.error;
    }

    const codes =
      selectedFeatureCodes();

    if (!codes.length) return;

    const insert = await supabase
      .from("vehicle_features")
      .insert(
        codes.map(featureCode => ({
          vehicle_id: vehicleId,
          feature_code: featureCode
        }))
      );

    if (insert.error) {
      throw insert.error;
    }
  }


  /*
  ============================================================
  SAVE PRICING
  ============================================================
  */

  async function savePricing(vehicleId) {
    const payload =
      pricingPayload(vehicleId);

    const result = await supabase
      .from("vehicle_pricing")
      .upsert(
        payload,
        {
          onConflict: "vehicle_id"
        }
      );

    if (result.error) {
      throw result.error;
    }
  }


  /*
  ============================================================
  SAVE PHOTOS
  ============================================================
  */

  async function savePhotos(
    vehicleId,
    vehicleCode
  ) {
    /*
    Upload new files before altering current DB
    photo rows.
    */

    const resolved = [];
    const newlyUploadedPaths = [];

    try {
      for (
        let index = 0;
        index < photoState.length;
        index += 1
      ) {
        const photo = photoState[index];

        if (photo.file) {
          const uploaded =
            await uploadPendingPhoto(
              photo,
              vehicleCode,
              index
            );

          resolved.push(uploaded);
          newlyUploadedPaths.push(
            uploaded.storage_path
          );
        } else {
          resolved.push({ ...photo });
        }
      }

      /*
      Snapshot existing rows so we can attempt
      a restoration if insertion fails.
      */

      const previousRows =
        originalPhotoState.map(photo => ({
          vehicle_id: vehicleId,
          image_url: photo.image_url,
          storage_path: photo.storage_path,
          sort_order: photo.sort_order,
          is_featured: photo.is_featured
        }));

      const deleteResult =
        await supabase
          .from("vehicle_photos")
          .delete()
          .eq("vehicle_id", vehicleId);

      if (deleteResult.error) {
        throw deleteResult.error;
      }

      if (resolved.length) {
        const rows =
          resolved.map(
            (photo, index) => ({
              vehicle_id: vehicleId,
              image_url: photo.image_url,
              storage_path:
                photo.storage_path,
              sort_order: index + 1,
              is_featured:
                Boolean(photo.is_featured)
            })
          );

        /*
        Featured must exist and remain first.
        */

        if (
          rows.length &&
          !rows.some(row => row.is_featured)
        ) {
          rows[0].is_featured = true;
        }

        const featuredIndex =
          rows.findIndex(
            row => row.is_featured
          );

        if (featuredIndex > 0) {
          const featured =
            rows.splice(
              featuredIndex,
              1
            )[0];

          rows.unshift(featured);

          rows.forEach(
            (row, index) => {
              row.sort_order = index + 1;
            }
          );
        }

        const insertResult =
          await supabase
            .from("vehicle_photos")
            .insert(rows);

        if (insertResult.error) {
          /*
          Attempt DB restoration.
          */

          if (previousRows.length) {
            await supabase
              .from("vehicle_photos")
              .insert(previousRows);
          }

          throw insertResult.error;
        }
      }

      /*
      Remove old storage files no longer used.
      */

      const activePaths =
        new Set(
          resolved
            .map(photo => photo.storage_path)
            .filter(Boolean)
        );

      const oldPathsToDelete =
        originalPhotoState
          .map(photo => photo.storage_path)
          .filter(
            path =>
              path &&
              !activePaths.has(path)
          );

      await removeStoragePaths(
        oldPathsToDelete
      );

    } catch (error) {
      /*
      New uploads must not become orphaned
      if DB synchronization fails.
      */

      await removeStoragePaths(
        newlyUploadedPaths
      );

      throw error;
    }
  }


  /*
  ============================================================
  SAVE VEHICLE
  ============================================================
  */

  async function saveVehicle(event) {
    event.preventDefault();

    hideAlert();

    const button =
      byId("save-vehicle");

    button.disabled = true;

    button.textContent =
      editingVehicle
        ? "Saving Changes..."
        : "Creating Vehicle...";

    let createdVehicleId = null;

    try {
      const payload =
        vehiclePayload();

      let vehicle;

      if (editingVehicle) {
        /*
        Code is immutable after initial creation.
        */

        delete payload.code;

        const result = await supabase
          .from("vehicles")
          .update(payload)
          .eq("id", editingVehicle.id)
          .select("*")
          .single();

        if (result.error) {
          throw result.error;
        }

        vehicle = result.data;

      } else {
        const result = await supabase
          .from("vehicles")
          .insert(payload)
          .select("*")
          .single();

        if (result.error) {
          throw result.error;
        }

        vehicle = result.data;
        createdVehicleId = vehicle.id;
      }

      await savePricing(vehicle.id);

      await saveFeatures(vehicle.id);

      await savePhotos(
        vehicle.id,
        vehicle.code
      );

      
      await saveAddonImages();
await loadVehicles();

      closeDrawer();

      showAlert(
        `${vehicle.name} saved successfully.`,
        "success"
      );

    } catch (error) {
      console.error(
        "Vehicle save error:",
        error
      );

      /*
      For a newly-created vehicle, if later
      operations fail, remove the incomplete
      vehicle record. Cascades remove pricing,
      features and photo rows.
      */

      if (createdVehicleId) {
        const cleanup =
          await supabase
            .from("vehicles")
            .delete()
            .eq(
              "id",
              createdVehicleId
            );

        if (cleanup.error) {
          console.warn(
            "New vehicle rollback warning:",
            cleanup.error
          );
        }
      }

      showAlert(
        error.message ||
          "Vehicle could not be saved."
      );

    } finally {
      button.disabled = false;

      button.textContent =
        editingVehicle
          ? "Save Changes"
          : "Save Vehicle";
    }
  }


  /*
  ============================================================
  PHOTO BUTTONS
  ============================================================
  */

  function setupPhotoControls() {
    document
      .querySelectorAll(
        "[data-photo-input]"
      )
      .forEach(input => {
        input.addEventListener(
          "change",
          handlePhotoInput
        );
      });

    document
      .querySelectorAll(
        '[data-action="feature-photo"]'
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const slot =
              button.closest(
                ".vehicle-photo-slot"
              );

            const index =
              Number(
                slot.dataset.photoPosition
              ) - 1;

            featurePhotoAt(index);
          }
        );
      });

    document
      .querySelectorAll(
        '[data-action="remove-photo"]'
      )
      .forEach(button => {
        button.addEventListener(
          "click",
          () => {
            const slot =
              button.closest(
                ".vehicle-photo-slot"
              );

            const index =
              Number(
                slot.dataset.photoPosition
              ) - 1;

            removePhotoAt(index);
          }
        );
      });

    setupPhotoDragAndDrop();
  }


  /*
  ============================================================
  PAGE CONTROLS
  ============================================================
  */


  /*
  ============================================================
  CUSTOMER ADD-ON IMAGE MANAGEMENT V2
  ============================================================
  */

  const ADDON_IMAGE_RULES = [
    {
      code: "forward_facing_seat",
      label: "Forward-facing Seat"
    },
    {
      code: "rear_facing_seat",
      label: "Rear-facing Seat"
    },
    {
      code: "booster_seat",
      label: "Booster Seat"
    }
  ];

  let addonImageState = new Map();


  function showAddonImageError(message) {
    const element = byId("addon-image-error");

    if (!element) return;

    element.textContent =
      message ||
      "Add-on image could not be processed.";

    element.hidden = false;

    element.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }


  function hideAddonImageError() {
    const element = byId("addon-image-error");

    if (!element) return;

    element.textContent = "";
    element.hidden = true;
  }


  function renderAddonImage(code) {
    const state =
      addonImageState.get(code);

    const image =
      byId(`addon-image-${code}`);

    const placeholder =
      byId(`addon-placeholder-${code}`);

    const removeButton =
      document.querySelector(
        `[data-addon-remove="${code}"]`
      );

    if (
      !state ||
      !image ||
      !placeholder ||
      !removeButton
    ) {
      return;
    }

    const source =
      state.previewUrl ||
      state.image_url ||
      "";

    if (source) {
      image.src = source;
      image.hidden = false;

      placeholder.hidden = true;
      removeButton.hidden = false;
    } else {
      image.removeAttribute("src");
      image.hidden = true;

      placeholder.hidden = false;
      removeButton.hidden = true;
    }
  }


  function renderAddonImages() {
    ADDON_IMAGE_RULES.forEach(
      rule => {
        renderAddonImage(rule.code);
      }
    );
  }


  async function loadAddonImages() {
    hideAddonImageError();

    addonImageState.forEach(
      state => {
        if (
          state.previewUrl &&
          state.previewUrl.startsWith("blob:")
        ) {
          URL.revokeObjectURL(
            state.previewUrl
          );
        }
      }
    );

    const codes =
      ADDON_IMAGE_RULES.map(
        rule => rule.code
      );

    const result =
      await supabase
        .from("pricing_rules")
        .select(
          "code, label, image_url"
        )
        .in(
          "code",
          codes
        );

    if (result.error) {
      throw result.error;
    }

    addonImageState = new Map();

    ADDON_IMAGE_RULES.forEach(
      rule => {
        const existing =
          (result.data || []).find(
            row =>
              row.code === rule.code
          );

        addonImageState.set(
          rule.code,
          {
            code: rule.code,
            label:
              existing?.label ||
              rule.label,
            image_url:
              existing?.image_url ||
              null,
            file: null,
            previewUrl: null,
            removeRequested: false
          }
        );
      }
    );

    renderAddonImages();
  }


  function validateAddonImageFile(file) {
    const allowedTypes =
      new Set([
        "image/jpeg",
        "image/png",
        "image/webp"
      ]);

    if (!allowedTypes.has(file.type)) {
      throw new Error(
        "Image must be JPG, PNG or WEBP."
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        "Image must be 5 MB or less."
      );
    }
  }


  function handleAddonImageInput(event) {
    hideAddonImageError();

    const input =
      event.currentTarget;

    const code =
      input.dataset.addonInput;

    const file =
      input.files?.[0];

    if (!code || !file) return;

    try {
      validateAddonImageFile(file);

      const state =
        addonImageState.get(code);

      if (!state) {
        throw new Error(
          "Add-on image state could not be found."
        );
      }

      if (
        state.previewUrl &&
        state.previewUrl.startsWith("blob:")
      ) {
        URL.revokeObjectURL(
          state.previewUrl
        );
      }

      state.file = file;

      state.previewUrl =
        URL.createObjectURL(file);

      state.removeRequested = false;

      addonImageState.set(
        code,
        state
      );

      renderAddonImage(code);

      input.value = "";

    } catch (error) {

      input.value = "";

      showAddonImageError(
        error.message ||
          "Image could not be selected."
      );
    }
  }


  function removeAddonImage(code) {
    hideAddonImageError();

    const state =
      addonImageState.get(code);

    if (!state) return;

    if (
      state.previewUrl &&
      state.previewUrl.startsWith("blob:")
    ) {
      URL.revokeObjectURL(
        state.previewUrl
      );
    }

    state.file = null;
    state.previewUrl = null;
    state.image_url = null;
    state.removeRequested = true;

    addonImageState.set(
      code,
      state
    );

    renderAddonImage(code);
  }


  function setupAddonImageControls() {

    document
      .querySelectorAll(
        "[data-addon-input]"
      )
      .forEach(
        input => {
          input.addEventListener(
            "change",
            handleAddonImageInput
          );
        }
      );

    document
      .querySelectorAll(
        "[data-addon-remove]"
      )
      .forEach(
        button => {
          button.addEventListener(
            "click",
            () => {
              removeAddonImage(
                button.dataset.addonRemove
              );
            }
          );
        }
      );
  }


  /*
  ============================================================
  SAVE CUSTOMER ADD-ON IMAGES
  ============================================================
  */

  async function saveAddonImages() {

    const bucketName =
      "addon-images";

    for (const rule of ADDON_IMAGE_RULES) {

      const state =
        addonImageState.get(rule.code);

      if (!state) continue;


      /*
      ========================================================
      UPLOAD / REPLACE IMAGE
      ========================================================
      */

      if (state.file) {

        validateAddonImageFile(
          state.file
        );

        const extension =
          (
            state.file.name
              .split(".")
              .pop() || "jpg"
          )
            .toLowerCase()
            .replace(
              /[^a-z0-9]/g,
              ""
            );

        const storagePath =
          `child-seats/${rule.code}.${extension}`;


        const uploadResult =
          await supabase.storage
            .from(bucketName)
            .upload(
              storagePath,
              state.file,
              {
                upsert: true,
                cacheControl: "3600",
                contentType:
                  state.file.type
              }
            );


        if (uploadResult.error) {
          throw new Error(
            `${rule.label} image upload failed: ${uploadResult.error.message}`
          );
        }


        const publicUrlResult =
          supabase.storage
            .from(bucketName)
            .getPublicUrl(
              storagePath
            );


        const publicUrl =
          publicUrlResult
            ?.data
            ?.publicUrl;


        if (!publicUrl) {
          throw new Error(
            `${rule.label} public image URL could not be created.`
          );
        }


        /*
        Add cache-busting version so replaced
        images update immediately in browser.
        */

        const versionedUrl =
          `${publicUrl}?v=${Date.now()}`;


        const rpcResult =
          await supabase.rpc(
            "admin_set_addon_image",
            {
              p_code:
                rule.code,

              p_image_url:
                versionedUrl
            }
          );


        if (rpcResult.error) {
          throw new Error(
            `${rule.label} image URL could not be saved: ${rpcResult.error.message}`
          );
        }


        if (
          state.previewUrl &&
          state.previewUrl.startsWith(
            "blob:"
          )
        ) {
          URL.revokeObjectURL(
            state.previewUrl
          );
        }


        state.file = null;

        state.previewUrl = null;

        state.image_url =
          versionedUrl;

        state.removeRequested =
          false;


        addonImageState.set(
          rule.code,
          state
        );


        continue;
      }


      /*
      ========================================================
      REMOVE IMAGE
      ========================================================
      */

      if (state.removeRequested) {

        /*
        Because old uploads may have different
        extensions, list files in child-seats
        and remove any matching add-on code.
        */

        const listResult =
          await supabase.storage
            .from(bucketName)
            .list(
              "child-seats",
              {
                limit: 100
              }
            );


        if (listResult.error) {
          throw new Error(
            `${rule.label} storage lookup failed: ${listResult.error.message}`
          );
        }


        const matchingPaths =
          (listResult.data || [])
            .filter(
              file =>
                String(
                  file.name || ""
                ).startsWith(
                  `${rule.code}.`
                )
            )
            .map(
              file =>
                `child-seats/${file.name}`
            );


        if (matchingPaths.length) {

          const removeResult =
            await supabase.storage
              .from(bucketName)
              .remove(
                matchingPaths
              );


          if (removeResult.error) {
            throw new Error(
              `${rule.label} image removal failed: ${removeResult.error.message}`
            );
          }
        }


        const rpcResult =
          await supabase.rpc(
            "admin_set_addon_image",
            {
              p_code:
                rule.code,

              p_image_url:
                null
            }
          );


        if (rpcResult.error) {
          throw new Error(
            `${rule.label} image record could not be cleared: ${rpcResult.error.message}`
          );
        }


        state.file = null;
        state.previewUrl = null;
        state.image_url = null;

        state.removeRequested =
          false;


        addonImageState.set(
          rule.code,
          state
        );
      }
    }


    renderAddonImages();
  }

  function setupControls() {
    byId("add-vehicle-button")
      .addEventListener(
        "click",
        openAddVehicle
      );

    byId("close-vehicle-drawer")
      .addEventListener(
        "click",
        closeDrawer
      );

    byId("cancel-vehicle")
      .addEventListener(
        "click",
        closeDrawer
      );

    byId("vehicle-drawer-backdrop")
      .addEventListener(
        "click",
        closeDrawer
      );

    byId("vehicle-form")
      .addEventListener(
        "submit",
        saveVehicle
      );

    byId("refresh-vehicles")
      .addEventListener(
        "click",
        loadVehicles
      );

    byId("vehicle-search")
      .addEventListener(
        "input",
        renderVehicleTable
      );

    byId("vehicle-status-filter")
      .addEventListener(
        "change",
        renderVehicleTable
      );

    byId("sign-out")
      .addEventListener(
        "click",
        signOut
      );

    document.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Escape" &&
          byId("vehicle-drawer")
            .classList
            .contains("is-open")
        ) {
          closeDrawer();
        }
      }
    );

    /*
    Convenient code generation while adding.
    Does not overwrite manually edited code.
    */

    byId("vehicle-name")
      .addEventListener(
        "input",
        () => {
          if (editingVehicle) return;

          const codeInput =
            byId("vehicle-code");

          if (
            codeInput.dataset.manual ===
            "true"
          ) {
            return;
          }

          codeInput.value =
            byId("vehicle-name")
              .value
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
        }
      );

    byId("vehicle-code")
      .addEventListener(
        "input",
        event => {
          if (!editingVehicle) {
            event.currentTarget.dataset.manual =
              "true";
          }

          event.currentTarget.value =
            event.currentTarget.value
              .toLowerCase()
              .replace(
                /[^a-z0-9_-]/g,
                ""
              );
        }
      );

    setupPhotoControls();


    setupAddonImageControls();
  }


  /*
  ============================================================
  INITIALIZE
  ============================================================
  */

  async function initialize() {
    try {
      const allowed =
        await protectPage();

      if (!allowed) return;

      setupControls();

      await loadFeatureCatalog();



      await loadAddonImages();
      await loadVehicles();

    } catch (error) {
      console.error(
        "Vehicle Management initialization error:",
        error
      );

      showAlert(
        error.message ||
          "Vehicle Management could not be initialized."
      );
    }
  }

  initialize();
})();