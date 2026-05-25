"use strict";

const STORAGE_VERSION = "20260508-referral-reset";
const LEGACY_STORAGE_KEYS = [
  "durianParadiseCart",
  "durianParadisePendingPayment",
  "durianParadiseReferral",
  "durianParadiseOwnedReferrals",
  "durianParadiseVisitorId"
];
const STORAGE_MIGRATION_KEY = `durianParadiseStorageMigration:${STORAGE_VERSION}`;
const CART_STORAGE_KEY = `durianParadiseCart:${STORAGE_VERSION}`;
const REVIEWS_API_PATH = "/api/reviews";
const STRIPE_CHECKOUT_SESSION_API_PATH = "/create-checkout-session";
const REFERRALS_API_PATH = "/api/referrals";
const ANALYTICS_EVENTS_API_PATH = "/api/analytics/events";
const PENDING_PAYMENT_STORAGE_KEY = `durianParadisePendingPayment:${STORAGE_VERSION}`;
const REFERRAL_STORAGE_KEY = `durianParadiseReferral:${STORAGE_VERSION}`;
const OWNED_REFERRALS_STORAGE_KEY = `durianParadiseOwnedReferrals:${STORAGE_VERSION}`;
const REFERRAL_LOOKUP_STORAGE_KEY = `durianParadiseReferralLookup:${STORAGE_VERSION}`;
const VISITOR_STORAGE_KEY = `durianParadiseVisitorId:${STORAGE_VERSION}`;
const DEFAULT_PAYMENT_METHOD_KEY = "stripe_checkout";
const CART_HISTORY_STATE_KEY = "__durianParadiseCartOpen";
let reviewsLoadPromise = null;
let lastOwnedReferralRefreshAt = 0;
let navMenusBound = false;
let cartUiBound = false;
let cartUiPrepared = false;
let productCardsBound = false;
let partyFormsBound = false;
let reviewFormBound = false;
let referralFormBound = false;
let pendingPaymentStatusRefreshPromise = null;
const memoryStorage = new Map();
const paymentStatusUtils = window.DurianPaymentStatus || null;

function clearCheckoutClientState() {
  if (paymentStatusUtils && typeof paymentStatusUtils.clearCheckoutState === "function") {
    paymentStatusUtils.clearCheckoutState();
    return;
  }

  saveCart([]);
  clearPendingPayment();
}

function normalizeOwnedReferralReward(reward) {
  if (!reward || typeof reward !== "object") {
    return null;
  }

  return {
    ...reward,
    id: String(reward.id || "").trim(),
    type: String(reward.type || "").trim(),
    status: String(reward.status || "").trim(),
    discountAmount: Number(reward.discountAmount || 0),
    message: reward.message ? String(reward.message) : "",
    referralCount: Number(reward.referralCount || 0),
    referralCycle: Number(reward.referralCycle || 0),
    orderId: reward.orderId ? String(reward.orderId) : "",
    claimedOrderId: reward.claimedOrderId ? String(reward.claimedOrderId) : ""
  };
}

function normalizeOwnedReferralEntry(referral) {
  if (!referral || typeof referral !== "object") {
    return null;
  }

  const normalized = {
    ...referral,
    code: String(referral.code || "").trim(),
    ownerToken: String(referral.ownerToken || "").trim(),
    link: String(referral.link || "").trim(),
    expiresAt: String(referral.expiresAt || "").trim(),
    conversionCount: Number(referral.conversionCount || 0),
    rewards: Array.isArray(referral.rewards)
      ? referral.rewards.map(normalizeOwnedReferralReward).filter(Boolean)
      : []
  };

  if (!normalized.code || !normalized.ownerToken) {
    return null;
  }

  return normalized;
}

function getIsoTimestamp(value) {
  const timestamp = Date.parse(String(value || "").trim());
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeClientReferralCode(code) {
  return String(code || "").replace(/\D+/g, "").slice(0, 4);
}

function isFourDigitClientReferralCode(code) {
  return /^\d{4}$/.test(normalizeClientReferralCode(code));
}

function buildClientReferralLink(code) {
  const normalizedCode = normalizeClientReferralCode(code);

  if (!isFourDigitClientReferralCode(normalizedCode)) {
    return "";
  }

  const url = new URL("/referral.html", window.location.origin);
  url.searchParams.set("code", normalizedCode);
  return url.toString();
}

function injectNavMenuStyles() {
  if (document.getElementById("nav-menu-fix-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "nav-menu-fix-styles";
  style.textContent = `
    .nav-group.is-open .nav-menu {
      display: grid !important;
      gap: 8px;
    }

    .nav-toggle {
      touch-action: manipulation;
    }

    @media (max-width: 820px) {
      .nav.has-open-menu {
        overflow: visible !important;
        flex-wrap: nowrap !important;
        justify-content: flex-start !important;
      }

      .nav.has-open-menu .nav-group {
        position: relative !important;
        padding-bottom: 12px !important;
        margin-bottom: -12px !important;
        flex: 0 0 auto;
        display: block;
      }

      .nav.has-open-menu .nav-group.is-open .nav-menu {
        position: absolute !important;
        top: calc(100% + 8px) !important;
        left: 50% !important;
        right: auto !important;
        transform: translateX(-50%) !important;
        width: min(320px, calc(100vw - 32px));
        max-width: 100%;
        margin: 0;
        z-index: 1105;
      }
    }
  `;

  document.head.appendChild(style);
}

function injectResponsiveStabilityStyles() {
  if (document.getElementById("responsive-stability-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "responsive-stability-styles";
  style.textContent = `
    @media (max-width: 820px) {
      .topbar-inner {
        display: grid !important;
        grid-template-columns: 1fr !important;
        justify-items: center !important;
        align-items: center !important;
        gap: 10px !important;
        padding-top: 14px !important;
        padding-right: 0 !important;
        padding-bottom: 14px !important;
        min-height: auto !important;
      }

      .site-logo {
        grid-column: auto !important;
        position: static !important;
        transform: none !important;
        justify-self: center !important;
        align-self: center !important;
        justify-content: center !important;
      }

      .site-logo img {
        width: 80px !important;
        height: 70px !important;
        max-height: 70px !important;
        object-fit: contain !important;
      }

      .nav,
      .nav.has-open-menu {
        width: 100% !important;
        flex: 0 0 auto !important;
        flex-wrap: nowrap !important;
        justify-content: flex-start !important;
        overflow-x: auto !important;
        overflow-y: visible !important;
        padding: 0 2px !important;
        margin: 0 !important;
        gap: 16px !important;
        -ms-overflow-style: none;
        scrollbar-width: none;
      }

      .nav::-webkit-scrollbar {
        display: none !important;
      }

      .nav a,
      .nav-toggle {
        white-space: nowrap !important;
        text-align: left !important;
        min-width: auto !important;
        max-width: none !important;
        font-size: 14px !important;
        padding: 6px 0 !important;
        line-height: 1.1 !important;
        flex: 0 0 auto !important;
      }

      .nav-group {
        position: relative !important;
        padding-bottom: 0 !important;
        margin-bottom: 0 !important;
        flex: 0 0 auto !important;
      }

      .nav-group.is-open .nav-menu {
        position: absolute !important;
        top: calc(100% + 8px) !important;
        left: 50% !important;
        right: auto !important;
        transform: translateX(-50%) !important;
        width: min(300px, calc(100vw - 32px)) !important;
        max-width: 100% !important;
        z-index: 1105 !important;
      }

      .header-cart-trigger {
        position: static !important;
        top: auto !important;
        right: auto !important;
        justify-self: end !important;
        align-self: center !important;
        margin-top: 4px !important;
        margin-left: auto !important;
      }
    }

    .product-layout .category-row {
      display: none !important;
    }

    .main-image-wrap {
      width: 100% !important;
      max-width: 520px !important;
      aspect-ratio: 4 / 3 !important;
      max-height: none !important;
      overflow: hidden !important;
      border-radius: 18px !important;
      background: linear-gradient(180deg, rgba(249, 243, 234, 0.98) 0%, rgba(239, 226, 207, 0.98) 100%) !important;
    }

    .main-image,
    .main-image.is-contained {
      width: 100% !important;
      height: 100% !important;
      object-fit: contain !important;
      object-position: center !important;
      background: transparent !important;
    }

    .thumb,
    .thumb img,
    .related-card .card-img-wrapper img {
      background: transparent !important;
    }

    .variety-gallery {
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
      gap: 0 !important;
      width: min(100%, 640px) !important;
      max-width: 100% !important;
      overflow: hidden !important;
      border-radius: 18px !important;
      background: linear-gradient(180deg, rgba(249, 243, 234, 0.98) 0%, rgba(239, 226, 207, 0.98) 100%) !important;
    }

    .variety-gallery.solid-black-gallery {
      background: linear-gradient(180deg, rgba(249, 243, 234, 0.98) 0%, rgba(239, 226, 207, 0.98) 100%) !important;
    }

    .variety-gallery .smart-image-frame,
    .variety-gallery > img {
      width: 100% !important;
      max-width: 100% !important;
      height: 240px !important;
      min-height: 240px !important;
      border-right: none !important;
      border-bottom: 1px solid rgba(120, 100, 76, 0.16) !important;
      object-fit: contain !important;
      object-position: center !important;
      display: block !important;
      background: transparent !important;
    }

    .variety-gallery .smart-image-frame:last-child,
    .variety-gallery > img:last-child {
      border-bottom: none !important;
    }

    .related-card .card-img-wrapper {
      border-radius: 18px !important;
      overflow: hidden !important;
      background: linear-gradient(180deg, rgba(249, 243, 234, 0.98) 0%, rgba(239, 226, 207, 0.98) 100%) !important;
    }

    .related-card .card-img-wrapper img {
      width: 100% !important;
      height: 220px !important;
      object-fit: contain !important;
      object-position: center !important;
      padding: 12px !important;
    }

    @media (max-width: 640px) {
      .variety-gallery {
        grid-template-columns: 1fr !important;
      }

      .variety-gallery .smart-image-frame,
      .variety-gallery > img {
        height: 220px !important;
        min-height: 220px !important;
      }

      .related-card .card-img-wrapper img {
        height: 200px !important;
      }
    }
  `;

  document.head.appendChild(style);
}

function readStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return memoryStorage.has(key) ? String(memoryStorage.get(key)) : null;
  }
}

function writeStorageItem(key, value) {
  const normalizedValue = String(value);

  try {
    localStorage.setItem(key, normalizedValue);
  } catch (_error) {
    memoryStorage.set(key, normalizedValue);
  }
}

function removeStorageItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (_error) {
    memoryStorage.delete(key);
    return;
  }

  memoryStorage.delete(key);
}

function bindTap(element, handler, options = {}) {
  if (!element || typeof handler !== "function") {
    return;
  }

  let lastPointerAt = 0;
  const shouldPreventDefault = Boolean(options.preventDefault);
  const shouldStopPropagation = Boolean(options.stopPropagation);

  const invoke = (event) => {
    if (shouldPreventDefault && event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    if (shouldStopPropagation && event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }

    handler(event);
  };

  if (window.PointerEvent) {
    element.addEventListener("pointerup", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      lastPointerAt = Date.now();
      invoke(event);
    });
  } else {
    element.addEventListener("touchend", (event) => {
      lastPointerAt = Date.now();
      invoke(event);
    }, { passive: !shouldPreventDefault });
  }

  element.addEventListener("click", (event) => {
    if (Date.now() - lastPointerAt < 700) {
      if (shouldPreventDefault && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      return;
    }

    invoke(event);
  });
}

function bindDelegatedTap(container, selector, handler, options = {}) {
  if (!container || !selector || typeof handler !== "function") {
    return;
  }

  let lastPointerAt = 0;
  const shouldPreventDefault = Boolean(options.preventDefault);
  const shouldStopPropagation = Boolean(options.stopPropagation);

  const resolveTarget = (event) => {
    const candidate = event && event.target && event.target.closest
      ? event.target.closest(selector)
      : null;

    if (!candidate || !container.contains(candidate)) {
      return null;
    }

    return candidate;
  };

  const invoke = (event) => {
    const target = resolveTarget(event);

    if (!target) {
      return;
    }

    if (shouldPreventDefault && event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    if (shouldStopPropagation && event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }

    handler(event, target);
  };

  if (window.PointerEvent) {
    container.addEventListener("pointerup", (event) => {
      const target = resolveTarget(event);

      if (!target) {
        return;
      }

      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      lastPointerAt = Date.now();
      invoke(event);
    });
  } else {
    container.addEventListener("touchend", (event) => {
      if (!resolveTarget(event)) {
        return;
      }

      lastPointerAt = Date.now();
      invoke(event);
    }, { passive: !shouldPreventDefault });
  }

  container.addEventListener("click", (event) => {
    if (!resolveTarget(event)) {
      return;
    }

    if (Date.now() - lastPointerAt < 700) {
      if (shouldPreventDefault && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      return;
    }

    invoke(event);
  });
}

function setActionButtonState(button, isReady) {
  if (!button) {
    return;
  }

  button.disabled = false;
  button.setAttribute("aria-disabled", isReady ? "false" : "true");
  button.classList.toggle("is-pending-selection", !isReady);
}

function clearLegacyStorageIfNeeded() {
  try {
    if (readStorageItem(STORAGE_MIGRATION_KEY) === "done") {
      return;
    }

    LEGACY_STORAGE_KEYS.forEach((key) => {
      removeStorageItem(key);
    });
    writeStorageItem(STORAGE_MIGRATION_KEY, "done");
  } catch (_error) {
    // Ignore storage cleanup failures and let the app continue.
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatCheckoutMoney(value) {
  const amount = Number(value || 0);
  if (Number.isInteger(amount)) {
    return formatCurrency(amount);
  }

  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatReviewDate(value) {
  try {
    return new Intl.DateTimeFormat("en-SG", {
      year: "numeric",
      month: "short",
      day: "numeric"
    }).format(new Date(value));
  } catch (_error) {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getReferralCycleStep(referralCount) {
  const value = Number(referralCount || 0);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return ((Math.round(value) - 1) % 3) + 1;
}

function getOrdinalLabel(value) {
  switch (Number(value || 0)) {
    case 1:
      return "1st";
    case 2:
      return "2nd";
    case 3:
      return "3rd";
    default:
      return `${value}th`;
  }
}

function getReferralRewardMessageText(reward) {
  const cycleStep = getReferralCycleStep(reward && reward.referralCount);

  if (reward && reward.type === "free_group1_box") {
    return `You received a free 500g box of Group 1 durians for the ${getOrdinalLabel(cycleStep || 3)} referral.`;
  }

  if (reward && Number(reward.discountAmount || 0) >= 1000) {
    return `You received a $10 discount for the ${getOrdinalLabel(cycleStep || 2)} referral.`;
  }

  return `You received a $5 discount for the ${getOrdinalLabel(cycleStep || 1)} referral.`;
}

function isLegacyReferralRewardMessage(message) {
  return /referring a friend/i.test(String(message || ""));
}

function normalizePaymentMethodKey(value) {
  return DEFAULT_PAYMENT_METHOD_KEY;
}

function getPaymentMethodConfig(methodKey) {
  return {
    key: DEFAULT_PAYMENT_METHOD_KEY,
    title: "Secure Checkout",
    checkoutButtonLabel: "Proceed to Secure Checkout",
    checkoutNote: "Customer details and payment will be completed on the secure checkout page.",
    copyButtonLabel: "Copy Stripe checkout link",
    qrImageLabel: "",
    supportsQr: false
  };
}

function readReviewImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      reject(new Error("Please upload a JPG, PNG, or WebP image."));
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      reject(new Error("Please upload an image smaller than 2MB."));
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Unable to read the image. Please try another file.")));
    reader.readAsDataURL(file);
  });
}

function loadCart() {
  try {
    const raw = readStorageItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function saveCart(cart) {
  writeStorageItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function loadPendingPayment() {
  try {
    const raw = readStorageItem(PENDING_PAYMENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function savePendingPayment(payment) {
  writeStorageItem(PENDING_PAYMENT_STORAGE_KEY, JSON.stringify(payment));
}

function clearPendingPayment() {
  removeStorageItem(PENDING_PAYMENT_STORAGE_KEY);
}

function isCartRelatedStorageKey(key) {
  const normalizedKey = String(key || "");
  return normalizedKey === CART_STORAGE_KEY
    || normalizedKey === PENDING_PAYMENT_STORAGE_KEY
    || normalizedKey.startsWith("durianParadiseCart")
    || normalizedKey.startsWith("durianParadisePendingPayment");
}

function isReferralRelatedStorageKey(key) {
  const normalizedKey = String(key || "");
  return normalizedKey === REFERRAL_STORAGE_KEY
    || normalizedKey === OWNED_REFERRALS_STORAGE_KEY
    || normalizedKey === REFERRAL_LOOKUP_STORAGE_KEY
    || normalizedKey.startsWith("durianParadiseReferral")
    || normalizedKey.startsWith("durianParadiseOwnedReferrals");
}

async function refreshPendingPaymentStatusIfNeeded(force = false) {
  const pendingPayment = loadPendingPayment();
  const sessionId = pendingPayment && pendingPayment.sessionId
    ? String(pendingPayment.sessionId).trim()
    : "";

  if (!sessionId) {
    return null;
  }

  const currentStatus = String(
    (pendingPayment.order && pendingPayment.order.paymentStatus)
      || pendingPayment.paymentStatus
      || ""
  ).trim().toLowerCase();

  if (currentStatus === "paid") {
    clearCheckoutClientState();
    renderCart();
    return null;
  }

  if (!force && currentStatus && currentStatus !== "checkout_pending") {
    return pendingPayment;
  }

  if (pendingPaymentStatusRefreshPromise) {
    return pendingPaymentStatusRefreshPromise;
  }

  pendingPaymentStatusRefreshPromise = (async () => {
    try {
      const statusResult = paymentStatusUtils
        ? await paymentStatusUtils.fetchCheckoutSessionStatus(sessionId)
        : await (async () => {
          const response = await fetch(`/api/checkout-sessions/${encodeURIComponent(sessionId)}/status`, {
            method: "GET",
            headers: {
              Accept: "application/json"
            },
            cache: "no-store"
          });
          const payload = await response.json().catch(() => ({}));
          return {
            ok: response.ok,
            payload,
            paymentStatus: String(
              payload && (payload.paymentStatus || (payload.order && payload.order.paymentStatus) || "")
            ).trim().toLowerCase()
          };
        })();

      if (!statusResult.ok) {
        return pendingPayment;
      }

      const nextStatus = String(
        statusResult.paymentStatus
          || (statusResult.payload.order && statusResult.payload.order.paymentStatus)
          || currentStatus
      ).trim().toLowerCase();

      if (nextStatus === "paid") {
        clearCheckoutClientState();
        renderCart();
        return null;
      }

      const nextPendingPayment = {
        ...pendingPayment,
        order: {
          ...(pendingPayment.order || {}),
          ...((statusResult && statusResult.payload && statusResult.payload.order) || {})
        },
        paymentStatus: nextStatus || pendingPayment.paymentStatus || ""
      };

      savePendingPayment(nextPendingPayment);

      if (force) {
        renderCart();
      }

      return nextPendingPayment;
    } catch (_error) {
      return pendingPayment;
    } finally {
      pendingPaymentStatusRefreshPromise = null;
    }
  })();

  return pendingPaymentStatusRefreshPromise;
}

function createBrowserId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getVisitorId() {
  try {
    const existing = String(readStorageItem(VISITOR_STORAGE_KEY) || "").trim();
    if (existing) {
      return existing;
    }

    const nextId = createBrowserId();
    writeStorageItem(VISITOR_STORAGE_KEY, nextId);
    return nextId;
  } catch (_error) {
    return createBrowserId();
  }
}

function loadOwnedReferrals() {
  try {
    const raw = readStorageItem(OWNED_REFERRALS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeOwnedReferralEntry).filter(Boolean)
      : [];
  } catch (_error) {
    return [];
  }
}

function saveOwnedReferrals(referrals) {
  const normalizedReferrals = Array.isArray(referrals)
    ? referrals.map(normalizeOwnedReferralEntry).filter(Boolean)
    : [];

  writeStorageItem(OWNED_REFERRALS_STORAGE_KEY, JSON.stringify(normalizedReferrals));
}

function storeOwnedReferral(referral) {
  const normalizedReferral = normalizeOwnedReferralEntry(referral);

  if (!normalizedReferral) {
    return;
  }

  const ownedReferrals = loadOwnedReferrals();
  const nextEntry = normalizedReferral;
  const existingIndex = ownedReferrals.findIndex((entry) =>
    entry.code === nextEntry.code || (entry.ownerToken && entry.ownerToken === nextEntry.ownerToken)
  );

  if (existingIndex >= 0) {
    ownedReferrals[existingIndex] = {
      ...ownedReferrals[existingIndex],
      ...nextEntry
    };
  } else {
    ownedReferrals.unshift(nextEntry);
  }

  saveOwnedReferrals(ownedReferrals.slice(0, 25));
}

function getStoredReferralLookupCode() {
  try {
    const storedCode = String(readStorageItem(REFERRAL_LOOKUP_STORAGE_KEY) || "").trim();

    if (!isFourDigitClientReferralCode(storedCode)) {
      removeStorageItem(REFERRAL_LOOKUP_STORAGE_KEY);
      return "";
    }

    return normalizeClientReferralCode(storedCode);
  } catch (_error) {
    return "";
  }
}

function setStoredReferralLookupCode(code) {
  const normalizedCode = normalizeClientReferralCode(code);

  if (!isFourDigitClientReferralCode(normalizedCode)) {
    removeStorageItem(REFERRAL_LOOKUP_STORAGE_KEY);
    return "";
  }

  writeStorageItem(REFERRAL_LOOKUP_STORAGE_KEY, normalizedCode);
  return normalizedCode;
}

function getLatestOwnedReferral(includeExpired = true, { allowLegacyCode = false } = {}) {
  return loadOwnedReferrals()
    .filter((entry) => {
      if (!entry.code || !entry.ownerToken) {
        return false;
      }

      if (!allowLegacyCode && !isFourDigitClientReferralCode(entry.code)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => getIsoTimestamp(right.createdAt || right.expiresAt) - getIsoTimestamp(left.createdAt || left.expiresAt))[0] || null;
}

function getReferralUiElements() {
  return {
    output: document.querySelector("[data-referral-output]"),
    codeEl: document.querySelector("[data-referral-code]"),
    linkEl: document.querySelector("[data-referral-link]"),
    lookupInput: document.querySelector("[data-referral-lookup-code]"),
    rewardsPanel: document.querySelector("[data-referral-status]")
  };
}

function showHomepageReferralLink(referral) {
  const { output, codeEl, linkEl, lookupInput } = getReferralUiElements();
  const normalizedCode = normalizeClientReferralCode(referral && referral.code ? referral.code : "");
  const nextLink = buildClientReferralLink(normalizedCode);

  if (!output || !linkEl) {
    return;
  }

  if (!nextLink) {
    output.classList.remove("is-visible");
    if (codeEl) {
      codeEl.textContent = "";
    }
    linkEl.textContent = "";
    return;
  }

  if (codeEl) {
    codeEl.textContent = normalizedCode;
  }

  if (lookupInput) {
    lookupInput.value = normalizedCode;
  }

  linkEl.textContent = nextLink;
  output.classList.add("is-visible");
}

function renderHomepageReferralStatus(referral) {
  const { rewardsPanel } = getReferralUiElements();

  if (!rewardsPanel) {
    return;
  }

  if (!referral || !referral.code) {
    rewardsPanel.hidden = true;
    rewardsPanel.innerHTML = "";
    return;
  }

  const rewards = Array.isArray(referral.rewards) ? referral.rewards : [];
  rewardsPanel.innerHTML = `
    <strong>Successful referrals recorded: ${Number(referral.conversionCount || 0)}</strong>
    ${rewards.length ? `
      <ul class="feature-list">
        ${rewards.map((reward) => `<li>${escapeHtml(getReferralRewardMessage(reward))}</li>`).join("")}
      </ul>
    ` : `<p>No available rewards are attached to this code yet.</p>`}
  `;
  rewardsPanel.hidden = false;
}

function syncHomepageReferralUi() {
  const { lookupInput } = getReferralUiElements();
  const existingReferral = getLatestOwnedReferral(false);

  if (existingReferral && isFourDigitClientReferralCode(existingReferral.code)) {
    showHomepageReferralLink(existingReferral);
    renderHomepageReferralStatus(existingReferral);
    return existingReferral;
  }

  renderHomepageReferralStatus(null);

  if (lookupInput) {
    lookupInput.value = getStoredReferralLookupCode();
  }

  return null;
}

function getReferralRewardMessage(reward) {
  if (reward && reward.message && !isLegacyReferralRewardMessage(reward.message)) {
    return String(reward.message);
  }

  return getReferralRewardMessageText(reward);
}

function getActiveOwnedReferralRewards() {
  return loadOwnedReferrals().reduce((result, referral) => {
    if (!isFourDigitClientReferralCode(referral.code)) {
      return result;
    }

    const rewards = Array.isArray(referral.rewards) ? referral.rewards : [];

    rewards.forEach((reward) => {
      if (!reward || typeof reward !== "object") {
        return;
      }

      if (String(reward.status || "") !== "issued_for_next_purchase") {
        return;
      }

      result.push({
        ...reward,
        referralCode: String(referral.code || ""),
        ownerToken: String(referral.ownerToken || ""),
        message: getReferralRewardMessage(reward)
      });
    });

    return result;
  }, []);
}

function markOwnedReferralRewardsAsClaimed(rewardClaims, orderId) {
  if (!Array.isArray(rewardClaims) || !rewardClaims.length) {
    return;
  }

  const claimKeys = new Set(
    rewardClaims.map((claim) => `${claim.referralCode || ""}::${claim.rewardId || ""}`)
  );
  const ownedReferrals = loadOwnedReferrals().map((referral) => ({
    ...referral,
    rewards: (Array.isArray(referral.rewards) ? referral.rewards : []).map((reward) => {
      const rewardKey = `${referral.code || ""}::${reward.id || ""}`;

      if (!claimKeys.has(rewardKey)) {
        return reward;
      }

      return {
        ...reward,
        status: "claimed",
        claimedAt: new Date().toISOString(),
        claimedOrderId: orderId || String(reward.claimedOrderId || "")
      };
    })
  }));

  saveOwnedReferrals(ownedReferrals);
}

function getRewardIdentityKey(reward) {
  return `${reward && reward.referralCode ? reward.referralCode : ""}::${reward && reward.id ? reward.id : ""}`;
}

function mergeReferralRewards(rewardGroups) {
  const merged = [];
  const seen = new Set();

  rewardGroups.forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((reward) => {
      const key = getRewardIdentityKey(reward);

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      merged.push(reward);
    });
  });

  return merged;
}

function getDisplayableReferralRewards() {
  return getActiveOwnedReferralRewards();
}

async function fetchReferralStatusByCode(code) {
  const normalizedCode = normalizeClientReferralCode(code);

  if (!isFourDigitClientReferralCode(normalizedCode)) {
    throw new Error("Enter a valid 4-digit referral code.");
  }

  const response = await fetch(`${REFERRALS_API_PATH}/${encodeURIComponent(normalizedCode)}`, {
    headers: {
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.referral) {
    throw new Error(payload.error || "Referral code not found.");
  }

  return {
    ...payload.referral,
    code: normalizedCode
  };
}

async function refreshOwnedReferralRewards() {
  const ownedReferrals = loadOwnedReferrals().filter((entry) => isFourDigitClientReferralCode(entry.code) && entry.ownerToken);

  if (!ownedReferrals.length) {
    syncHomepageReferralUi();
    renderCart();
    return;
  }

  const updatedReferrals = await Promise.all(ownedReferrals.map(async (entry) => {
    try {
      const response = await fetch(`${REFERRALS_API_PATH}/${encodeURIComponent(entry.code)}/owner-status?ownerToken=${encodeURIComponent(entry.ownerToken)}`, {
        headers: {
          Accept: "application/json"
        }
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.referral) {
        return entry;
      }

      return normalizeOwnedReferralEntry({
        ...entry,
        ...payload.referral
      }) || entry;
    } catch (_error) {
      return entry;
    }
  }));

  saveOwnedReferrals(updatedReferrals);
  syncHomepageReferralUi();
  renderCart();
}

function refreshOwnedReferralRewardsIfNeeded(force = false) {
  const now = Date.now();

  if (!force && now - lastOwnedReferralRefreshAt < 60 * 1000) {
    return Promise.resolve();
  }

  lastOwnedReferralRefreshAt = now;
  return refreshOwnedReferralRewards().catch(() => {});
}

function getStoredReferralCode() {
  try {
    const raw = readStorageItem(REFERRAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const normalizedCode = normalizeClientReferralCode(parsed && parsed.code ? parsed.code : "");

    if (!parsed || !isFourDigitClientReferralCode(normalizedCode)) {
      removeStorageItem(REFERRAL_STORAGE_KEY);
      return "";
    }

    return normalizedCode;
  } catch (_error) {
    removeStorageItem(REFERRAL_STORAGE_KEY);
    return "";
  }
}

function setStoredReferralCode(code) {
  const normalizedCode = normalizeClientReferralCode(code);

  if (!isFourDigitClientReferralCode(normalizedCode)) {
    removeStorageItem(REFERRAL_STORAGE_KEY);
    return "";
  }

  writeStorageItem(REFERRAL_STORAGE_KEY, JSON.stringify({
    code: normalizedCode
  }));
  return normalizedCode;
}

function captureReferralCode() {
  const params = new URLSearchParams(window.location.search);
  const code = normalizeClientReferralCode(params.get("ref"));

  if (!isFourDigitClientReferralCode(code)) {
    return;
  }

  writeStorageItem(REFERRAL_STORAGE_KEY, JSON.stringify({
    code
  }));
}

function clearStoredReferralCode() {
  removeStorageItem(REFERRAL_STORAGE_KEY);
}

function getPageCategory() {
  const path = window.location.pathname.toLowerCase();

  if (path === "/" || path.endsWith("/index.html")) {
    return "homepage";
  }

  if (path.includes("group-1-durians")) {
    return "group_1";
  }

  if (path.includes("group-2-durians")) {
    return "group_2";
  }

  if (path.includes("group-3-durians")) {
    return "group_3";
  }

  if (path.includes("referral")) {
    return "referral";
  }

  if (path.includes("contact")) {
    return "contact";
  }

  if (path.includes("success")) {
    return "success";
  }

  return "other";
}

function trackAnalyticsEvent(type, details = {}) {
  const payload = {
    type,
    visitorId: getVisitorId(),
    path: window.location.pathname,
    pageCategory: getPageCategory(),
    referrer: document.referrer || "",
    referralCode: details.referralCode || "",
    orderId: details.orderId || "",
    metadata: details.metadata || {}
  };

  fetch(ANALYTICS_EVENTS_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    keepalive: true,
    body: JSON.stringify(payload)
  }).catch(() => {});
}

function getCartCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function syncCartTriggerState(cart = loadCart(), pendingPayment = loadPendingPayment()) {
  const count = getCartCount(cart);
  const shouldShowTrigger = count > 0 || Boolean(pendingPayment && pendingPayment.sessionId);

  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    el.textContent = String(count);
  });

  document.querySelectorAll("[data-cart-trigger]").forEach((trigger) => {
    trigger.hidden = !shouldShowTrigger;
    trigger.setAttribute("aria-hidden", shouldShowTrigger ? "false" : "true");
  });
}

function getCartDrawerElements() {
  return {
    drawer: document.getElementById("cart-drawer"),
    overlay: document.getElementById("cart-overlay"),
    triggers: Array.from(document.querySelectorAll("[data-cart-trigger]"))
  };
}

function hasCartHistoryState(state = window.history && window.history.state) {
  return Boolean(state && typeof state === "object" && state[CART_HISTORY_STATE_KEY]);
}

function getCartHistoryState() {
  const currentState = window.history && window.history.state;

  if (!currentState || typeof currentState !== "object") {
    return {};
  }

  return currentState;
}

function syncCartDrawerState(isOpen) {
  const { drawer, overlay, triggers } = getCartDrawerElements();

  if (!drawer || !overlay) {
    return false;
  }

  drawer.classList.toggle("is-open", isOpen);
  overlay.classList.toggle("is-open", isOpen);
  drawer.setAttribute("aria-hidden", isOpen ? "false" : "true");
  triggers.forEach((trigger) => {
    trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  return true;
}

function resetCartDrawerState() {
  syncCartDrawerState(false);
}

function syncCartDrawerWithHistoryState(state = window.history && window.history.state) {
  if (hasCartHistoryState(state)) {
    prepareCartUI();
    syncCartDrawerState(true);
    return;
  }

  resetCartDrawerState();
}

function getCartTotal(cart) {
  return cart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
}

function calculateCartPricing(cart) {
  const deliveryItems = cart.filter((item) => item.orderType === "Online Delivery");
  const partyItems = cart.filter((item) => item.orderType !== "Online Delivery");
  const deliveryBoxCount = deliveryItems.reduce((sum, item) => sum + item.quantity, 0);
  const deliverySubtotal = deliveryItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  const partySubtotal = partyItems.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  const minimumDeliveryBoxesMet = deliveryBoxCount === 0 || deliveryBoxCount >= 3;
  const deliveryFee = deliveryBoxCount >= 3 && deliveryBoxCount < 4 ? 22 : 0;
  const deliveryDiscount = deliveryBoxCount >= 4 ? Number((deliverySubtotal * 0.10).toFixed(2)) : 0;

  const deliveryUnitPrices = [];
  deliveryItems.forEach((item) => {
    for (let index = 0; index < item.quantity; index += 1) {
      deliveryUnitPrices.push(item.unitPrice);
    }
  });
  deliveryUnitPrices.sort((left, right) => left - right);

  const freeBoxCount = Math.floor(deliveryBoxCount / 6);
  const freeBoxDiscount = deliveryUnitPrices
    .slice(0, freeBoxCount)
    .reduce((sum, amount) => sum + amount, 0);

  const subtotalBeforeAdjustments = deliverySubtotal + partySubtotal;
  const total = subtotalBeforeAdjustments + deliveryFee - deliveryDiscount - freeBoxDiscount;

  return {
    deliveryBoxCount,
    deliverySubtotal,
    partySubtotal,
    subtotalBeforeAdjustments,
    deliveryFee,
    deliveryDiscount,
    freeBoxCount,
    freeBoxDiscount,
    minimumDeliveryBoxesMet,
    total,
    notes: [
      "Delivery fee at $22 applies for 3 boxes.",
      "Free delivery and 10% discount apply for 4 boxes and above.",
      "Buy 5 boxes, the 6th box from Group 1 with 500g is free."
    ]
  };
}

function applyReferralRewardsToPricing(pricing, rewards) {
  const activeRewards = (Array.isArray(rewards) ? rewards : [])
    .map(normalizeOwnedReferralReward)
    .filter(Boolean);
  const cashRewardTotal = activeRewards
    .filter((reward) => reward.type === "cash_discount")
    .reduce((sum, reward) => sum + (Number(reward.discountAmount || 0) / 100), 0);
  const referralCashDiscount = Math.min(Number(pricing.total || 0), cashRewardTotal);
  const referralFreeBoxCount = activeRewards
    .filter((reward) => reward.type === "free_group1_box")
    .length;

  return {
    ...pricing,
    referralCashDiscount,
    referralFreeBoxCount,
    referralRewardMessages: activeRewards.map((reward) => getReferralRewardMessage(reward)),
    total: Math.max(0, Number(pricing.total || 0) - referralCashDiscount)
  };
}

function flashAddedState(button) {
  if (!button) {
    return;
  }

  const originalText = button.dataset.originalText || button.textContent || "Add to Cart";
  button.dataset.originalText = originalText;
  button.dataset.feedbackLockUntil = String(Date.now() + 450);
  button.textContent = "Added";

  window.setTimeout(() => {
    button.textContent = originalText;
    delete button.dataset.feedbackLockUntil;
    const card = button.closest("[data-product-card], [data-party-form]");
    const selectedRows = card
      ? Array.from(card.querySelectorAll("[data-variant-row]")).filter((row) => Number(row.dataset.quantity || 0) > 0)
      : [];

    if (selectedRows.length) {
      setActionButtonState(button, true);
      return;
    }

    const select = card && (card.querySelector("[data-variant-select]") || card.querySelector("[data-party-select]"));
    const option = select && select.options ? select.options[select.selectedIndex] : null;
    setActionButtonState(button, Boolean(option && option.value));
  }, 900);
}

function getItemKey(item) {
  return `${item.productId}::${item.variantValue}`;
}

function addToCart(item) {
  const cart = loadCart();
  const existing = cart.find((entry) => getItemKey(entry) === getItemKey(item));

  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push(item);
  }

  saveCart(cart);
  return cart;
}

function updateCartQuantity(itemKey, delta) {
  const cart = loadCart();
  const item = cart.find((entry) => getItemKey(entry) === itemKey);

  if (!item) {
    return cart;
  }

  item.quantity += delta;

  const nextCart = cart.filter((entry) => entry.quantity > 0);
  saveCart(nextCart);
  return nextCart;
}

function removeCartItem(itemKey) {
  const nextCart = loadCart().filter((entry) => getItemKey(entry) !== itemKey);
  saveCart(nextCart);
  return nextCart;
}

function injectCartStyles() {
  if (document.getElementById("cart-ui-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "cart-ui-styles";
  style.textContent = `
    .cart-overlay {
      position: fixed;
      inset: 0;
      background: rgba(24, 18, 12, 0.38);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
      z-index: 1200;
    }

    .cart-overlay.is-open {
      opacity: 1;
      pointer-events: auto;
    }

    .cart-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: min(540px, 100vw);
      height: 100vh;
      background: linear-gradient(180deg, #f7f1e7 0%, #eee3d3 100%);
      box-shadow: -24px 0 40px rgba(42, 29, 16, 0.18);
      transform: translateX(100%);
      transition: transform 0.28s ease;
      z-index: 1250;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .cart-drawer.is-open {
      transform: translateX(0);
    }

    .cart-drawer__header,
    .cart-drawer__footer {
      padding: 22px 22px 18px;
      border-bottom: 1px solid rgba(120, 100, 76, 0.14);
      background: rgba(252, 249, 245, 0.74);
      flex: 0 0 auto;
    }

    .cart-drawer__footer {
      border-bottom: none;
      border-top: 1px solid rgba(120, 100, 76, 0.14);
    }

    .cart-drawer__title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .cart-drawer h2 {
      margin: 0;
      font-size: 30px;
      line-height: 1.1;
    }

    .cart-close {
      border: none;
      background: transparent;
      font-size: 28px;
      line-height: 1;
      cursor: pointer;
      color: #47382b;
    }

    .cart-drawer__body {
      overflow: visible;
      padding: 18px 22px 22px;
      display: grid;
      gap: 14px;
      align-content: start;
      flex: 0 0 auto;
    }

    .cart-empty {
      padding: 18px;
      border-radius: 18px;
      background: rgba(252, 249, 245, 0.84);
      border: 1px solid rgba(120, 100, 76, 0.12);
      color: #5a4a3b;
    }

    .cart-line {
      background: rgba(252, 249, 245, 0.88);
      border: 1px solid rgba(120, 100, 76, 0.12);
      border-radius: 18px;
      padding: 16px;
      display: grid;
      gap: 12px;
    }

    .cart-line__type {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #7a5e39;
    }

    .cart-line__name {
      font-size: 18px;
      font-weight: 700;
      color: #1f1a15;
    }

    .cart-line__variant {
      color: #5a4a3b;
      font-size: 15px;
    }

    .cart-line__meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .cart-quantity-controls {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: rgba(244, 236, 224, 0.92);
      border-radius: 999px;
      padding: 6px;
    }

    .cart-quantity-controls button,
    .cart-remove {
      border: none;
      cursor: pointer;
      font-family: inherit;
      touch-action: manipulation;
    }

    .cart-quantity-controls button {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      background: #fff;
      color: #403023;
      font-size: 18px;
    }

    .cart-remove {
      background: transparent;
      color: #8a5e47;
      font-size: 14px;
      padding: 0;
    }

    .cart-line__subtotal {
      font-size: 17px;
      font-weight: 700;
      color: #1f1a15;
    }

    .cart-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 14px;
    }

    .cart-summary strong {
      font-size: 26px;
      line-height: 1.1;
    }

    .cart-summary span {
      color: #5a4a3b;
      font-size: 15px;
    }

    .cart-breakdown {
      display: grid;
      gap: 8px;
      margin-bottom: 12px;
      padding: 14px;
      border-radius: 16px;
      background: rgba(252, 249, 245, 0.78);
      border: 1px solid rgba(120, 100, 76, 0.12);
    }

    .cart-breakdown-line {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: 14px;
      color: #2d241c;
      font-size: 14px;
    }

    .cart-breakdown-line strong {
      font-size: 15px;
    }

    .cart-breakdown-line.is-discount strong,
    .cart-breakdown-line.is-discount span:last-child {
      color: #486c32;
    }

    .cart-breakdown-line.is-note {
      justify-content: flex-start;
      color: #5a4a3b;
      font-size: 13px;
      line-height: 1.4;
    }

    .cart-breakdown-line.is-highlight {
      display: block;
      padding: 14px 16px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(111, 83, 48, 0.12) 0%, rgba(157, 119, 65, 0.18) 100%);
      border: 1px solid rgba(157, 119, 65, 0.18);
      color: #2d241c;
    }

    .cart-breakdown-line.is-highlight strong,
    .cart-breakdown-line.is-highlight span {
      display: block;
      margin: 0;
    }

    .cart-breakdown-line.is-highlight strong {
      font-size: 15px;
      margin-bottom: 4px;
    }

    .cart-breakdown-line.is-highlight span {
      font-size: 14px;
      color: #5a4a3b;
      line-height: 1.45;
    }

    .cart-breakdown-line.is-reward {
      display: block;
      padding: 14px 16px;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(72, 108, 50, 0.12) 0%, rgba(170, 204, 126, 0.22) 100%);
      border: 1px solid rgba(72, 108, 50, 0.18);
      color: #1f1a15;
    }

    .cart-breakdown-line.is-reward strong,
    .cart-breakdown-line.is-reward span {
      display: block;
      margin: 0;
    }

    .cart-breakdown-line.is-reward strong {
      font-size: 15px;
      margin-bottom: 4px;
    }

    .cart-breakdown-line.is-reward span {
      font-size: 14px;
      color: #355123;
      line-height: 1.45;
    }

    .cart-breakdown-warning {
      color: #a34835;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 700;
    }

    .checkout-note {
      color: #5a4a3b;
      font-size: 14px;
      margin-bottom: 14px;
    }

    .checkout-referral {
      display: grid;
      gap: 8px;
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 16px;
      background: rgba(252, 249, 245, 0.72);
      border: 1px solid rgba(120, 100, 76, 0.12);
    }

    .checkout-referral label {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #1f1a15;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .checkout-referral input {
      width: 100%;
      box-sizing: border-box;
      border-radius: 14px;
      border: 1px solid rgba(120, 100, 76, 0.2);
      background: rgba(255, 255, 255, 0.96);
      color: #1f1a15;
      padding: 12px 14px;
      font-size: 16px;
      font-family: inherit;
    }

    .checkout-referral small {
      color: #6a5845;
      font-size: 13px;
      line-height: 1.4;
    }

    .checkout-payment-methods {
      display: grid;
      gap: 10px;
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 16px;
      background: rgba(252, 249, 245, 0.72);
      border: 1px solid rgba(120, 100, 76, 0.12);
    }

    .checkout-payment-methods h3 {
      margin: 0;
      font-size: 16px;
      color: #1f1a15;
    }

    .checkout-payment-option {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      padding: 12px;
      border-radius: 14px;
      background: rgba(255, 250, 244, 0.82);
      border: 1px solid rgba(120, 100, 76, 0.12);
      cursor: pointer;
    }

    .checkout-payment-option input {
      margin-top: 3px;
      accent-color: #6f5330;
    }

    .checkout-payment-option strong,
    .checkout-payment-option small {
      display: block;
    }

    .checkout-payment-option strong {
      color: #1f1a15;
      font-size: 15px;
      margin-bottom: 2px;
    }

    .checkout-payment-option small {
      color: #5a4a3b;
      font-size: 13px;
      line-height: 1.45;
    }

    .checkout-details {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
      margin-bottom: 10px;
      padding: 12px;
      border-radius: 16px;
      background: rgba(252, 249, 245, 0.72);
      border: 1px solid rgba(120, 100, 76, 0.12);
    }

    .checkout-details h3 {
      margin: 0;
      font-size: 16px;
      color: #1f1a15;
      grid-column: 1 / -1;
    }

    .checkout-field {
      display: grid;
      gap: 6px;
    }

    .checkout-field label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #5a4a3b;
    }

    .checkout-field input,
    .checkout-field textarea {
      width: 100%;
      border: 1px solid rgba(120, 100, 76, 0.2);
      border-radius: 12px;
      background: #fffaf4;
      color: #1f1a15;
      font: inherit;
      padding: 9px 11px;
    }

    .checkout-field textarea {
      min-height: 46px;
      resize: vertical;
    }

    .checkout-field:nth-of-type(4) {
      grid-column: auto;
    }

    .checkout-field:nth-of-type(5) {
      grid-column: 1 / -1;
    }

    .payment-request-card {
      margin-top: 16px;
      padding: 16px;
      border-radius: 16px;
      background: rgba(252, 249, 245, 0.88);
      border: 1px solid rgba(120, 100, 76, 0.12);
      display: grid;
      gap: 10px;
    }

    .payment-request-card h3 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      color: #1f1a15;
    }

    .payment-request-card p {
      margin: 0;
      color: #4d3d2f;
      font-size: 14px;
      line-height: 1.45;
    }

    .payment-request-total {
      display: grid;
      gap: 4px;
      padding: 16px;
      border-radius: 16px;
      background: linear-gradient(135deg, rgba(111, 83, 48, 0.12), rgba(157, 119, 65, 0.18));
      border: 1px solid rgba(120, 100, 76, 0.14);
    }

    .payment-request-total span {
      color: #5a4a3b;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .payment-request-total strong {
      color: #1f1a15;
      font-size: 34px;
      line-height: 1;
    }

    .payment-detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .payment-detail {
      padding: 12px;
      border-radius: 14px;
      background: rgba(255, 250, 244, 0.78);
      border: 1px solid rgba(120, 100, 76, 0.1);
      overflow-wrap: anywhere;
    }

    .payment-detail span {
      display: block;
      color: #6a5845;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .payment-detail strong {
      color: #1f1a15;
      font-size: 15px;
    }

    .payment-request-qr {
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 14px;
      border-radius: 16px;
      background: rgba(255, 250, 244, 0.78);
      border: 1px solid rgba(120, 100, 76, 0.1);
      text-align: center;
    }

    .payment-request-qr span {
      color: #5a4a3b;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .paynow-qr-frame {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      border-radius: 24px;
      background: linear-gradient(180deg, #ffffff 0%, #f8f4ed 100%);
      border: 1px solid rgba(120, 100, 76, 0.14);
      box-shadow: 0 14px 28px rgba(72, 52, 28, 0.08);
    }

    .paynow-qr-image {
      width: min(220px, 100%);
      aspect-ratio: 1;
      display: block;
      border-radius: 16px;
      background: #fff;
      border: 1px solid rgba(120, 100, 76, 0.1);
      padding: 0;
      object-fit: contain;
    }

    .payment-order-summary {
      display: grid;
      gap: 8px;
      margin-top: 4px;
    }

    .payment-order-line {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: start;
      padding: 10px 0;
      border-bottom: 1px solid rgba(120, 100, 76, 0.12);
    }

    .payment-order-line:last-child {
      border-bottom: none;
    }

    .payment-order-line.is-total {
      margin-top: 4px;
      padding-top: 14px;
      border-top: 2px solid rgba(120, 100, 76, 0.16);
      border-bottom: none;
    }

    .payment-order-line.is-total strong:last-child {
      font-size: 18px;
    }

    .payment-order-line small {
      display: block;
      color: #6a5845;
      margin-top: 3px;
      line-height: 1.35;
    }

    .payment-order-line.is-muted strong:last-child {
      color: #486c32;
      font-size: 15px;
    }

    .payment-request-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(232, 221, 203, 0.86);
      border: 1px solid rgba(120, 100, 76, 0.14);
      font-family: "Inter", sans-serif;
      font-size: 14px;
      font-weight: 700;
      color: #2d241c;
      width: fit-content;
      max-width: 100%;
    }

    .payment-request-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .payment-request-copy,
    .payment-request-clear,
    .payment-request-paid {
      border: none;
      background: transparent;
      color: #8a5e47;
      font-size: 14px;
      font-weight: 700;
      padding: 0;
      cursor: pointer;
      font-family: inherit;
      touch-action: manipulation;
    }

    .payment-request-paid {
      width: 100%;
      padding: 13px 16px;
      border-radius: 12px;
      background: linear-gradient(135deg, #486c32 0%, #6f8b43 100%);
      color: #fffaf1;
      box-shadow: 0 12px 24px rgba(72, 108, 50, 0.16);
    }

    .payment-request-paid:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      box-shadow: none;
    }

    .checkout-button {
      width: 100%;
      border: none;
      background: linear-gradient(135deg, #6f5330 0%, #9d7741 100%);
      color: #fffaf1;
      padding: 15px 18px;
      border-radius: 12px;
      font-family: "Inter", sans-serif;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 14px 28px rgba(104, 73, 36, 0.18);
      touch-action: manipulation;
    }

    @media (max-width: 520px) {
      .cart-drawer {
        left: 0;
        right: 0;
        width: 100vw;
        height: 100dvh;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        transform: translateX(100%);
      }

    .cart-drawer.is-open {
      transform: translateX(0);
    }

      .cart-drawer__header {
        position: sticky;
        top: 0;
        z-index: 2;
        padding: 16px;
        flex: 0 0 auto;
      }

      .cart-drawer__footer {
        padding: 14px 16px 28px;
        flex: 0 0 auto;
      }

      .cart-drawer__body {
        overflow: visible;
        padding: 12px 16px;
        flex: 0 0 auto;
      }

      .cart-drawer h2 {
        font-size: 24px;
      }

      .cart-line {
        padding: 12px;
        gap: 8px;
      }

      .cart-line__name {
        font-size: 16px;
      }

      .cart-line__variant {
        font-size: 13px;
      }

      .cart-summary {
        margin-bottom: 10px;
      }

      .cart-summary strong {
        font-size: 22px;
      }

      .checkout-details {
        grid-template-columns: 1fr;
        gap: 7px;
        padding: 10px;
      }

      .checkout-field:nth-of-type(4),
      .checkout-field:nth-of-type(5) {
        grid-column: auto;
      }

      .payment-detail-grid {
        grid-template-columns: 1fr;
      }

      .payment-request-card {
        margin-top: 12px;
        padding: 12px;
      }

      .payment-request-total {
        padding: 12px;
      }

      .payment-request-total strong {
        font-size: 28px;
      }
    }

    .checkout-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      box-shadow: none;
    }

    .reviews-feed {
      display: grid;
      gap: 16px;
    }

    .review-empty {
      color: #5a4a3b;
      padding: 18px;
      border-radius: 18px;
      background: rgba(246, 239, 228, 0.66);
      border: 1px dashed rgba(170, 156, 138, 0.3);
    }

    .review-card {
      padding: 18px;
      border-radius: 18px;
      background: rgba(252, 249, 245, 0.88);
      border: 1px solid rgba(120, 100, 76, 0.12);
    }

    .review-card__top {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: start;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .review-card__name {
      font-size: 18px;
      font-weight: 700;
      color: #1f1a15;
    }

    .review-card__date {
      color: #6a5845;
      font-size: 14px;
    }

    .review-stars {
      letter-spacing: 0.08em;
      color: #b07c2a;
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .review-card p {
      font-size: 16px;
      color: #222;
      margin: 0;
    }

    .smart-image-frame {
      position: relative;
      overflow: hidden;
      background: #111;
    }

    .smart-image-frame::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image: var(--image-src);
      background-position: center;
      background-repeat: no-repeat;
      background-size: cover;
      filter: blur(18px);
      transform: scale(1.14);
      opacity: 0.88;
    }

    .smart-image-frame > img.smart-image-fg {
      position: relative;
      z-index: 1;
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: transparent !important;
    }
  `;

  document.head.appendChild(style);
}

function revealPage() {
  if (!document.body) {
    return;
  }

  document.body.classList.remove("page-loading");
  document.body.classList.add("page-ready");
}

function revealPageWhenCriticalImagesReady() {
  if (!document.body) {
    return;
  }

  const reveal = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(revealPage);
    });
  };

  const criticalImages = Array.from(document.querySelectorAll([
    ".site-logo img",
    ".split-image img",
    ".product-layout .main-image",
    "img[loading=\"eager\"]",
    "img[fetchpriority=\"high\"]"
  ].join(",")));

  if (!criticalImages.length) {
    reveal();
    return;
  }

  const waitForImage = (img) => {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }

    if (typeof img.decode === "function") {
      return img.decode().catch(() => {});
    }

    return new Promise((resolve) => {
      const finish = () => {
        img.removeEventListener("load", finish);
        img.removeEventListener("error", finish);
        resolve();
      };

      img.addEventListener("load", finish, { once: true });
      img.addEventListener("error", finish, { once: true });
    });
  };

  Promise.race([
    Promise.allSettled(criticalImages.map(waitForImage)),
    new Promise((resolve) => window.setTimeout(resolve, 600))
  ]).finally(reveal);
}

function runNonCriticalTask(task, timeout = 400) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => {
      task();
    }, { timeout });
    return;
  }

  window.setTimeout(task, 0);
}

function runWhenElementNearViewport(target, callback, options = {}) {
  const element = typeof target === "string" ? document.querySelector(target) : target;

  if (!element || typeof callback !== "function") {
    return;
  }

  const rootMargin = options.rootMargin || "360px 0px";
  const immediate = Boolean(options.immediate);
  const hash = String(options.hash || "").trim();
  const isHashMatch = hash && window.location.hash === hash;
  const shouldRunNow = immediate
    || isHashMatch
    || element.getBoundingClientRect().top < (window.innerHeight * 1.25);

  if (shouldRunNow || !("IntersectionObserver" in window)) {
    callback();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      return;
    }

    observer.disconnect();
    callback();
  }, { rootMargin });

  observer.observe(element);
}

function scrollToSection(targetSelector) {
  const target = document.querySelector(targetSelector);

  if (!target) {
    return;
  }

  const header = document.querySelector(".site-header");
  const headerOffset = header ? header.getBoundingClientRect().height + 16 : 16;
  const targetTop = target.getBoundingClientRect().top + window.scrollY - headerOffset;

  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth"
  });
}

function bindPrimaryCtas() {
  document.querySelectorAll("[data-scroll-target]").forEach((trigger) => {
    if (trigger.dataset.scrollBound === "true") {
      return;
    }

    trigger.dataset.scrollBound = "true";
    bindTap(trigger, () => {
      const targetSelector = trigger.getAttribute("data-scroll-target");

      if (!targetSelector) {
        return;
      }

      scrollToSection(targetSelector);
    }, { preventDefault: true });
  });
}

function bindNavMenus() {
  if (navMenusBound) {
    return;
  }

  const navGroups = document.querySelectorAll(".nav-group");
  if (!navGroups.length) {
    return;
  }

  navMenusBound = true;

  const closeAllNavMenus = () => {
    navGroups.forEach((group) => {
      group.classList.remove("is-open");
      const toggle = group.querySelector(".nav-toggle");
      const nav = group.closest(".nav");
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
      }
      if (nav) {
        nav.classList.remove("has-open-menu");
      }
    });
  };

  navGroups.forEach((group) => {
    const toggle = group.querySelector(".nav-toggle");
    if (!toggle) {
      return;
    }

    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-haspopup", "true");

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = group.classList.contains("is-open");
      const nav = group.closest(".nav");
      closeAllNavMenus();

      if (!isOpen) {
        group.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
        if (nav) {
          nav.classList.add("has-open-menu");
        }
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-group")) {
      closeAllNavMenus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllNavMenus();
    }
  });
}

function enhanceVarietyImages() {
  return;
}

function ensureCartUI() {
  injectCartStyles();

  if (!document.getElementById("cart-overlay")) {
    const overlay = document.createElement("div");
    overlay.id = "cart-overlay";
    overlay.className = "cart-overlay";
    overlay.setAttribute("data-cart-overlay", "");
    document.body.appendChild(overlay);
  }

  if (!document.getElementById("cart-drawer")) {
    const drawer = document.createElement("aside");
    drawer.id = "cart-drawer";
    drawer.className = "cart-drawer";
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML = `
      <div class="cart-drawer__header">
        <div class="cart-drawer__title-row">
          <h2>Your Cart</h2>
          <button class="cart-close" type="button" aria-label="Close cart" data-cart-close>&times;</button>
        </div>
      </div>
      <div class="cart-drawer__body" data-cart-body></div>
      <div class="cart-drawer__footer">
        <div class="cart-summary">
          <div>
            <span>Total</span>
            <strong data-cart-total>${formatCurrency(0)}</strong>
          </div>
          <span data-cart-items-label>0 items</span>
        </div>
        <div class="cart-breakdown" data-cart-breakdown></div>
        <div class="checkout-referral">
          <label for="cart-referral-code">Referral Code (if any)</label>
          <input id="cart-referral-code" type="text" maxlength="4" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter 4-digit referral code" data-cart-referral-code />
          <small>If a friend shared a referral code with you, enter it here before payment so the referral reward can be recorded.</small>
        </div>
        <div class="checkout-payment-methods">
          <h3>Payment Method</h3>
          <label class="checkout-payment-option">
            <input type="radio" name="checkout-payment-method" value="stripe_checkout" data-checkout-payment-method checked />
            <span>
              <strong>Secure Checkout</strong>
              <small>Stripe will collect the customer name, email, phone number, and Singapore delivery address during checkout.</small>
            </span>
          </label>
        </div>
        <p class="checkout-note" data-checkout-payment-note>Customer details and payment will be completed on the secure checkout page.</p>
        <button class="checkout-button" type="button" data-cart-checkout disabled>Proceed to Secure Checkout</button>
        <div data-payment-request></div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  bindCartTrigger();
}

function prepareCartUI() {
  if (cartUiPrepared) {
    renderCart();
    return;
  }

  cartUiPrepared = true;
  ensureCartUI();
  bindCartUI();
  renderCart();
}

function getSelectedCheckoutPaymentMethodKey() {
  const selectedInput = document.querySelector("[data-checkout-payment-method]:checked");
  return normalizePaymentMethodKey(selectedInput ? selectedInput.value : DEFAULT_PAYMENT_METHOD_KEY);
}

function syncCheckoutPaymentMethodUI() {
  const config = getPaymentMethodConfig(getSelectedCheckoutPaymentMethodKey());
  const note = document.querySelector("[data-checkout-payment-note]");
  const checkoutButton = document.querySelector("[data-cart-checkout]");

  if (note) {
    note.textContent = config.checkoutNote;
  }

  if (checkoutButton) {
    checkoutButton.textContent = config.checkoutButtonLabel;
  }
}

function openCartDrawer() {
  prepareCartUI();

  if (!syncCartDrawerState(true)) {
    return;
  }

  if (window.history && typeof window.history.pushState === "function" && !hasCartHistoryState()) {
    window.history.pushState({
      ...getCartHistoryState(),
      [CART_HISTORY_STATE_KEY]: true
    }, "", window.location.href);
  }

  refreshOwnedReferralRewardsIfNeeded(true);
  void refreshPendingPaymentStatusIfNeeded(true);
}

function closeCartDrawer(options = {}) {
  if (!options.skipHistory && hasCartHistoryState() && window.history && typeof window.history.back === "function") {
    window.history.back();
    return;
  }

  resetCartDrawerState();
}

function renderCartBreakdown(breakdown, isCents = false) {
  if (!breakdown) {
    return "";
  }

  const convert = (value) => isCents ? Number(value || 0) / 100 : Number(value || 0);
  const lines = [];
  const rewardMessages = Array.isArray(breakdown.referralRewardMessages) ? breakdown.referralRewardMessages : [];

  lines.push(`
    <div class="cart-breakdown-line">
      <strong>Items subtotal</strong>
      <span>${escapeHtml(formatCheckoutMoney(convert(breakdown.subtotalBeforeAdjustments)))}</span>
    </div>
  `);

  if (breakdown.deliveryBoxCount > 0) {
    lines.push(`
      <div class="cart-breakdown-line">
        <span>Online Delivery boxes (${escapeHtml(breakdown.deliveryBoxCount)})</span>
        <span>${escapeHtml(formatCheckoutMoney(convert(breakdown.deliverySubtotal)))}</span>
      </div>
    `);
  }

  if (convert(breakdown.partySubtotal) > 0) {
    lines.push(`
      <div class="cart-breakdown-line">
        <span>Durian Party packages</span>
        <span>${escapeHtml(formatCheckoutMoney(convert(breakdown.partySubtotal)))}</span>
      </div>
    `);
  }

  if (convert(breakdown.deliveryFee) > 0) {
    lines.push(`
      <div class="cart-breakdown-line">
        <span>Delivery fee</span>
        <span>${escapeHtml(formatCheckoutMoney(convert(breakdown.deliveryFee)))}</span>
      </div>
    `);
  } else if (breakdown.deliveryBoxCount >= 4) {
    lines.push(`
      <div class="cart-breakdown-line is-discount">
        <span>Delivery fee</span>
        <span>Free</span>
      </div>
    `);
  }

  if (convert(breakdown.deliveryDiscount) > 0) {
    lines.push(`
      <div class="cart-breakdown-line is-discount">
        <span>10% delivery discount</span>
        <span>-${escapeHtml(formatCheckoutMoney(convert(breakdown.deliveryDiscount)))}</span>
      </div>
    `);
  }

  if (convert(breakdown.freeBoxDiscount) > 0) {
    lines.push(`
      <div class="cart-breakdown-line is-discount">
        <span>Free delivery box reward (${escapeHtml(breakdown.freeBoxCount)})</span>
        <span>-${escapeHtml(formatCheckoutMoney(convert(breakdown.freeBoxDiscount)))}</span>
      </div>
    `);

    const paidBoxes = Number(breakdown.deliveryBoxCount || 0);
    const freeBoxes = Number(breakdown.freeBoxCount || 0);
    const totalBoxes = paidBoxes + freeBoxes;
    const paidLabel = paidBoxes === 1 ? "box" : "boxes";
    const freeLabel = freeBoxes === 1 ? "free box" : "free boxes";
    const totalLabel = totalBoxes === 1 ? "box" : "boxes";

    lines.push(`
      <div class="cart-breakdown-line is-highlight">
        <strong>Free box applied</strong>
        <span>${escapeHtml(`${paidBoxes} ${paidLabel} + ${freeBoxes} ${freeLabel}. Total: ${totalBoxes} ${totalLabel}.`)}</span>
      </div>
    `);
  }

  rewardMessages.forEach((message) => {
    lines.push(`
      <div class="cart-breakdown-line is-reward">
        <strong>Referral Reward Received</strong>
        <span>${escapeHtml(message)}</span>
      </div>
    `);
  });

  if (convert(breakdown.referralCashDiscount) > 0) {
    lines.push(`
      <div class="cart-breakdown-line is-discount">
        <span>Referral reward applied</span>
        <span>-${escapeHtml(formatCheckoutMoney(convert(breakdown.referralCashDiscount)))}</span>
      </div>
    `);
  }

  if (Number(breakdown.referralFreeBoxCount || 0) > 0) {
    const rewardCount = Number(breakdown.referralFreeBoxCount || 0);
    lines.push(`
      <div class="cart-breakdown-line is-highlight">
        <strong>Free Group 1 box reward ready</strong>
        <span>${escapeHtml(`${rewardCount} free box reward${rewardCount === 1 ? "" : "s"} will be attached to this order.`)}</span>
      </div>
    `);
  }

  if (!breakdown.minimumDeliveryBoxesMet) {
    lines.push(`
      <div class="cart-breakdown-warning">Online Delivery requires a minimum of 3 boxes before checkout.</div>
    `);
  }

  if (Array.isArray(breakdown.notes)) {
    breakdown.notes.forEach((note) => {
      lines.push(`<div class="cart-breakdown-line is-note">${escapeHtml(note)}</div>`);
    });
  }

  return `<div class="cart-breakdown">${lines.join("")}</div>`;
}

function renderPaymentSummaryLine(title, value, detail = "", options = {}) {
  const { isTotal = false, isMuted = false } = options;

  return `
    <div class="payment-order-line${isTotal ? " is-total" : ""}${isMuted ? " is-muted" : ""}">
      <div>
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ""}
      </div>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function buildPaymentRequestOrderSummary(items, breakdown, totalDisplay) {
  const lines = [];

  items.forEach((item) => {
    const itemDetailParts = [];
    if (item.variantLabel) {
      itemDetailParts.push(item.variantLabel);
    }
    itemDetailParts.push(`Qty ${item.quantity || 1}`);
    lines.push(renderPaymentSummaryLine(
      item.name || "Durian item",
      formatCurrency(Number(item.subtotalAmount || 0) / 100),
      itemDetailParts.join(" · ")
    ));
  });

  if (breakdown) {
    const deliveryFee = Number(breakdown.deliveryFee || 0) / 100;
    const deliveryDiscount = Number(breakdown.deliveryDiscount || 0) / 100;
    const freeBoxDiscount = Number(breakdown.freeBoxDiscount || 0) / 100;
    const referralCashDiscount = Number(breakdown.referralCashDiscount || 0) / 100;
    const deliveryBoxCount = Number(breakdown.deliveryBoxCount || 0);
    const freeBoxCount = Number(breakdown.freeBoxCount || 0);
    const referralFreeBoxCount = Number(breakdown.referralFreeBoxCount || 0);

    if (deliveryBoxCount > 0) {
      const deliveryFeeValue = deliveryFee > 0 ? formatCurrency(deliveryFee) : "Free";
      const deliveryFeeDetail = deliveryFee > 0
        ? `${deliveryBoxCount} delivery ${deliveryBoxCount === 1 ? "box" : "boxes"} in this order`
        : deliveryBoxCount >= 4
          ? "Free delivery applied for 4 boxes and above"
          : "Included in this order";
      lines.push(renderPaymentSummaryLine("Delivery Fee", deliveryFeeValue, deliveryFeeDetail));
    }

    if (deliveryDiscount > 0) {
      lines.push(renderPaymentSummaryLine(
        "10% Delivery Discount",
        `-${formatCurrency(deliveryDiscount)}`,
        "Applied automatically for 4 boxes and above"
      ));
    }

    if (freeBoxDiscount > 0 && freeBoxCount > 0) {
      const paidBoxes = deliveryBoxCount;
      const totalBoxes = paidBoxes + freeBoxCount;
      lines.push(renderPaymentSummaryLine(
        `Free Group 1 Durian Box (${freeBoxCount})`,
        `-${formatCurrency(freeBoxDiscount)}`,
        `${paidBoxes} paid ${paidBoxes === 1 ? "box" : "boxes"} + ${freeBoxCount} free ${freeBoxCount === 1 ? "box" : "boxes"} = ${totalBoxes} boxes total`
      ));
    }

    if (referralCashDiscount > 0) {
      lines.push(renderPaymentSummaryLine(
        "Referral Discount",
        `-${formatCurrency(referralCashDiscount)}`
      ));
    }

    if (referralFreeBoxCount > 0) {
      lines.push(renderPaymentSummaryLine(
        `Referral Free Group 1 Box (${referralFreeBoxCount})`,
        "Included",
        `${referralFreeBoxCount} free 500g Group 1 ${referralFreeBoxCount === 1 ? "box is" : "boxes are"} attached to this order`,
        { isMuted: true }
      ));
    }
  }

  lines.push(renderPaymentSummaryLine("Total Price To Pay", totalDisplay, "", { isTotal: true }));
  return lines.join("");
}

function renderPaymentRequestCard(pendingPayment) {
  if (!pendingPayment) {
    return "";
  }

  const paymentMethod = getPaymentMethodConfig(
    pendingPayment.paymentMethodKey || pendingPayment.paymentMethod || DEFAULT_PAYMENT_METHOD_KEY
  );
  const order = pendingPayment.order || {};
  const customer = order.customer || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const paymentConfirmed = String(order.paymentStatus || pendingPayment.paymentStatus || "") === "paid";
  const breakdown = order.summary && order.summary.priceBreakdown ? order.summary.priceBreakdown : null;
  const totalDisplay = pendingPayment.amountDisplay || order.summary?.totalDisplay || "";
  const orderLines = buildPaymentRequestOrderSummary(items, breakdown, totalDisplay);
  const checkoutUrl = String(pendingPayment.checkoutUrl || "").trim();
  const qrCodeDataUrl = String(pendingPayment.qrCodeDataUrl || "").trim();

  return `
    <div class="payment-request-card">
      <h3>${escapeHtml(paymentMethod.title)}</h3>
      <div class="payment-request-total">
        <span>${paymentMethod.supportsQr ? "Amount To Pay After Scanning" : "Amount To Pay"}</span>
        <strong>${escapeHtml(totalDisplay)}</strong>
      </div>
      ${paymentMethod.supportsQr ? `
        <div class="payment-request-qr">
          <span>${escapeHtml(paymentMethod.qrImageLabel)}</span>
          ${qrCodeDataUrl ? `<div class="paynow-qr-frame"><img class="paynow-qr-image" src="${escapeHtml(qrCodeDataUrl)}" alt="Stripe Checkout QR code" width="220" height="220" loading="eager" decoding="async" /></div>` : ""}
        </div>
      ` : ""}
      <div class="payment-detail-grid">
        <div class="payment-detail">
          <span>Payment Method</span>
          <strong>${escapeHtml(paymentMethod.title)}</strong>
        </div>
        <div class="payment-detail">
          <span>Order No</span>
          <strong>${escapeHtml(pendingPayment.reference || order.id || "")}</strong>
        </div>
      </div>
      ${(items.length || breakdown) ? `<div class="payment-order-summary"><h3>Order Summary</h3>${orderLines}</div>` : ""}
      <p>${escapeHtml(pendingPayment.message || "")}</p>
      ${paymentConfirmed ? `<p><strong>Payment has been confirmed.</strong> Your order is now marked as paid.</p>` : ""}
      <div class="payment-request-actions">
        ${!paymentConfirmed && checkoutUrl ? `<a class="btn-email" href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noopener">Open Payment Page</a>` : ""}
        <button class="payment-request-clear" type="button" data-clear-payment-request>Clear payment panel</button>
      </div>
    </div>
  `;
}

function renderCart() {
  const cart = loadCart();
  const activeReferralRewards = getDisplayableReferralRewards();
  const countEls = document.querySelectorAll("[data-cart-count]");
  const body = document.querySelector("[data-cart-body]");
  const totalEl = document.querySelector("[data-cart-total]");
  const itemsLabel = document.querySelector("[data-cart-items-label]");
  const checkoutButton = document.querySelector("[data-cart-checkout]");
  const paymentRequest = document.querySelector("[data-payment-request]");
  const breakdownEl = document.querySelector("[data-cart-breakdown]");
  const referralInput = document.querySelector("[data-cart-referral-code]");
  const pendingPayment = loadPendingPayment();
  const pricing = applyReferralRewardsToPricing(calculateCartPricing(cart), activeReferralRewards);
  syncCartTriggerState(cart, pendingPayment);

  countEls.forEach((el) => {
    el.textContent = String(getCartCount(cart));
  });

  if (referralInput && document.activeElement !== referralInput) {
    referralInput.value = getStoredReferralCode();
  }

  if (!body || !totalEl || !itemsLabel || !checkoutButton) {
    return;
  }

  totalEl.textContent = formatCheckoutMoney(pricing.total);
  itemsLabel.textContent = `${getCartCount(cart)} item${getCartCount(cart) === 1 ? "" : "s"}`;
  checkoutButton.disabled = cart.length === 0 || !pricing.minimumDeliveryBoxesMet;
  if (breakdownEl) {
    breakdownEl.innerHTML = renderCartBreakdown(pricing);
  }

  if (!cart.length) {
    body.innerHTML = `<div class="cart-empty">Your cart is empty. Add a durian package from the homepage and it will appear here immediately.</div>`;
    if (paymentRequest) {
      paymentRequest.innerHTML = renderPaymentRequestCard(pendingPayment);
    }
    return;
  }

  body.innerHTML = cart.map((item) => `
    <article class="cart-line" data-cart-item-key="${getItemKey(item)}">
      <div class="cart-line__type">${item.orderType}</div>
      <div class="cart-line__name">${item.productName}</div>
      <div class="cart-line__variant">${item.variantLabel}</div>
      <div class="cart-line__meta">
        <div class="cart-quantity-controls">
          <button type="button" data-cart-decrease>-</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-increase>+</button>
        </div>
        <div class="cart-line__subtotal">${formatCurrency(item.unitPrice * item.quantity)}</div>
      </div>
      <button class="cart-remove" type="button" data-cart-remove>Remove</button>
    </article>
  `).join("");

  if (paymentRequest) {
    paymentRequest.innerHTML = renderPaymentRequestCard(pendingPayment);
  }

  syncCheckoutPaymentMethodUI();
}

function bindCartTrigger() {
  document.querySelectorAll("[data-cart-trigger]").forEach((trigger) => {
    if (trigger.dataset.cartTriggerBound === "true") {
      return;
    }

    trigger.dataset.cartTriggerBound = "true";
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openCartDrawer();
    });
  });
}

function bindCartUI() {
  if (cartUiBound) {
    return;
  }

  cartUiBound = true;

  const overlay = document.querySelector("[data-cart-overlay]");
  const close = document.querySelector("[data-cart-close]");
  const body = document.querySelector("[data-cart-body]");
  const checkout = document.querySelector("[data-cart-checkout]");
  const paymentRequest = document.querySelector("[data-payment-request]");
  const paymentMethodInputs = document.querySelectorAll("[data-checkout-payment-method]");
  const referralInput = document.querySelector("[data-cart-referral-code]");

  bindCartTrigger();

  if (overlay) {
    overlay.addEventListener("click", (event) => {
      event.preventDefault();
      closeCartDrawer();
    });
  }

  if (close) {
    close.addEventListener("click", (event) => {
      event.preventDefault();
      closeCartDrawer();
    });
  }

  if (body && body.dataset.cartBodyBound !== "true") {
    body.dataset.cartBodyBound = "true";
    body.addEventListener("click", (event) => {
      const target = event.target.closest("[data-cart-increase], [data-cart-decrease], [data-cart-remove]");
      if (!target || !body.contains(target)) {
        return;
      }

      event.preventDefault();
      const item = target.closest("[data-cart-item-key]");
      if (!item) {
        return;
      }

      const itemKey = item.getAttribute("data-cart-item-key");

      if (target.matches("[data-cart-increase]")) {
        updateCartQuantity(itemKey, 1);
        renderCart();
        return;
      }

      if (target.matches("[data-cart-decrease]")) {
        updateCartQuantity(itemKey, -1);
        renderCart();
        return;
      }

      if (target.matches("[data-cart-remove]")) {
        removeCartItem(itemKey);
        renderCart();
      }
    });
  }

  if (paymentRequest && paymentRequest.dataset.paymentRequestBound !== "true") {
    paymentRequest.dataset.paymentRequestBound = "true";
    paymentRequest.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-clear-payment-request]");
      if (!target || !paymentRequest.contains(target)) {
        return;
      }

      event.preventDefault();
      if (target.matches("[data-clear-payment-request]")) {
        clearPendingPayment();
        renderCart();
      }
    });
  }

  paymentMethodInputs.forEach((input) => {
    input.addEventListener("change", syncCheckoutPaymentMethodUI);
  });

  if (referralInput && referralInput.dataset.inputBound !== "true") {
    referralInput.dataset.inputBound = "true";
    referralInput.addEventListener("input", () => {
      referralInput.value = normalizeClientReferralCode(referralInput.value);
    });
    referralInput.addEventListener("change", () => {
      const normalizedCode = normalizeClientReferralCode(referralInput.value);
      referralInput.value = normalizedCode;

      if (!normalizedCode) {
        clearStoredReferralCode();
        return;
      }

      setStoredReferralCode(normalizedCode);
    });
  }

  if (checkout) {
    checkout.addEventListener("click", async (event) => {
      event.preventDefault();
      const cart = loadCart();
      const selectedPaymentMethod = getPaymentMethodConfig(getSelectedCheckoutPaymentMethodKey());
      const activeReferralRewards = getDisplayableReferralRewards();
      const pricing = applyReferralRewardsToPricing(calculateCartPricing(cart), activeReferralRewards);
      const referralCodeInputValue = referralInput ? normalizeClientReferralCode(referralInput.value) : "";
      const effectiveReferralCode = referralCodeInputValue || getStoredReferralCode();
      const referralRewardClaims = activeReferralRewards.map((reward) => ({
        referralCode: reward.referralCode,
        rewardId: reward.id
      })).filter((claim) => claim.referralCode && claim.rewardId);

      if (!cart.length) {
        return;
      }

      if (!pricing.minimumDeliveryBoxesMet) {
        window.alert("Online Delivery requires a minimum of 3 boxes.");
        return;
      }

      if (referralInput && referralInput.value && !isFourDigitClientReferralCode(referralCodeInputValue)) {
        window.alert("Please enter a valid 4-digit referral code.");
        referralInput.focus();
        return;
      }

      if (effectiveReferralCode) {
        setStoredReferralCode(effectiveReferralCode);
      } else {
        clearStoredReferralCode();
      }

      trackAnalyticsEvent("checkout_started", {
        metadata: {
          itemCount: getCartCount(cart)
        }
      });

      checkout.disabled = true;
      checkout.textContent = selectedPaymentMethod.supportsQr
        ? "Preparing Payment..."
        : "Redirecting To Payment...";

      try {
        const response = await fetch(STRIPE_CHECKOUT_SESSION_API_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            items: cart.map((item) => ({
              productId: item.productId,
              variantValue: item.variantValue,
              quantity: item.quantity
            })),
            paymentMethodKey: selectedPaymentMethod.key,
            referralCode: effectiveReferralCode,
            referralRewardClaims,
            totalAmount: Math.round(Number(pricing.total || 0) * 100),
            visitorId: getVisitorId(),
            path: window.location.pathname,
            pageCategory: getPageCategory()
          })
        });

        const payload = await response.json();

        if (!response.ok || !payload.order || !payload.checkoutUrl) {
          throw new Error(payload.error || "Unable to start payment.");
        }

        savePendingPayment({
          order: payload.order,
          reference: payload.order.id || "",
          amountDisplay: payload.order.summary?.totalDisplay || formatCheckoutMoney(pricing.total),
          checkoutUrl: payload.checkoutUrl || "",
          qrCodeDataUrl: payload.qrCodeDataUrl || "",
          sessionId: payload.sessionId || "",
          paymentMethodKey: selectedPaymentMethod.key,
          paymentMethod: selectedPaymentMethod.title,
          paymentStatus: payload.order.paymentStatus || "checkout_pending",
          message: selectedPaymentMethod.supportsQr
            ? "Open the payment page to pay the exact validated amount."
            : "Redirecting you to the secure payment page."
        });
        renderCart();
        const updatedPaymentRequest = document.querySelector("[data-payment-request]");
        if (selectedPaymentMethod.supportsQr && updatedPaymentRequest) {
          updatedPaymentRequest.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        if (!selectedPaymentMethod.supportsQr) {
          window.location.assign(payload.checkoutUrl);
        }
        checkout.disabled = false;
        syncCheckoutPaymentMethodUI();
      } catch (error) {
        window.alert(error && error.message ? error.message : "Unable to start payment.");
        checkout.disabled = false;
        syncCheckoutPaymentMethodUI();
      }
    });
  }
}

function bindProductCards() {
  document.querySelectorAll("[data-product-card]").forEach((card) => {
    if (card.dataset.productCardBound === "true") {
      return;
    }

    card.dataset.productCardBound = "true";
    const button = card.querySelector("[data-add-product]");
    const rows = Array.from(card.querySelectorAll("[data-variant-row]"));

    if (!button || !rows.length) {
      return;
    }

    const syncCardState = () => {
      const selectedRows = rows.filter((row) => Number(row.dataset.quantity || 0) > 0);
      setActionButtonState(button, selectedRows.length > 0);
    };

    rows.forEach((row) => {
      row.dataset.quantity = row.dataset.quantity || "0";
      const qtyEl = row.querySelector("[data-variant-quantity]");
      const decrease = row.querySelector("[data-variant-decrease]");
      const increase = row.querySelector("[data-variant-increase]");

      const updateQty = (nextQuantity) => {
        const quantity = Math.max(0, nextQuantity);
        row.dataset.quantity = String(quantity);
        if (qtyEl) {
          qtyEl.textContent = String(quantity);
        }
        syncCardState();
      };

      if (decrease && decrease.dataset.tapBound !== "true") {
        decrease.dataset.tapBound = "true";
        decrease.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          updateQty(Number(row.dataset.quantity || 0) - 1);
        });
      }

      if (increase && increase.dataset.tapBound !== "true") {
        increase.dataset.tapBound = "true";
        increase.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          updateQty(Number(row.dataset.quantity || 0) + 1);
        });
      }

      if (row.dataset.tapBound !== "true") {
        row.dataset.tapBound = "true";
        row.addEventListener("click", (event) => {
          if (event.target.closest("button")) {
            return;
          }

          updateQty(Number(row.dataset.quantity || 0) + 1);
        });
      }

      updateQty(Number(row.dataset.quantity || 0));
    });

    syncCardState();
    button.textContent = "Add to Cart";

    if (button.dataset.tapBound !== "true") {
      button.dataset.tapBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (Date.now() < Number(button.dataset.feedbackLockUntil || 0)) {
          return;
        }

        const selectedRows = rows.filter((row) => Number(row.dataset.quantity || 0) > 0);

        if (!selectedRows.length) {
          return;
        }

        selectedRows.forEach((row) => {
          const item = {
            productId: card.dataset.productId || "",
            productName: card.dataset.productName || "Durian Package",
            orderType: card.dataset.orderType || "Online Delivery",
            variantValue: row.dataset.variantValue || "",
            variantLabel: row.dataset.variantLabel || "",
            unitPrice: Number(row.dataset.unitPrice || 0),
            quantity: Number(row.dataset.quantity || 0)
          };

          addToCart(item);
          trackAnalyticsEvent("add_to_cart", {
            metadata: {
              productId: item.productId,
              variantValue: item.variantValue,
              itemCount: item.quantity
            }
          });
        });

        renderCart();
        flashAddedState(button);
        rows.forEach((row) => {
          row.dataset.quantity = "0";
          const qtyEl = row.querySelector("[data-variant-quantity]");
          if (qtyEl) {
            qtyEl.textContent = "0";
          }
        });
        window.setTimeout(syncCardState, 900);
      });
    }
  });
}

function bindPartyForms() {
  document.querySelectorAll("[data-party-form]").forEach((form) => {
    if (form.dataset.partyFormBound === "true") {
      return;
    }

    form.dataset.partyFormBound = "true";
    const select = form.querySelector("[data-party-select]");
    const button = form.querySelector("[data-add-party]");

    if (!select || !button) {
      return;
    }

    const syncPartyButton = () => {
      const option = select.options[select.selectedIndex];
      setActionButtonState(button, Boolean(option && option.value));
    };

    syncPartyButton();
    select.addEventListener("change", syncPartyButton);
    button.textContent = "Add to Cart";

    if (button.dataset.tapBound !== "true") {
      button.dataset.tapBound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (Date.now() < Number(button.dataset.feedbackLockUntil || 0)) {
          return;
        }

        const option = select.options[select.selectedIndex];
        if (!option || !option.value) {
          if (typeof select.focus === "function") {
            select.focus();
          }
          return;
        }

        const item = {
          productId: form.dataset.productIdBase || "",
          productName: form.dataset.productName || "Durian Party",
          orderType: form.dataset.orderType || "Durian Party",
          variantValue: option.value,
          variantLabel: option.dataset.label || option.textContent,
          unitPrice: Number(option.dataset.price || 0),
          quantity: 1,
        };

        addToCart(item);
        trackAnalyticsEvent("add_to_cart", {
          metadata: {
            productId: item.productId,
            variantValue: item.variantValue,
            itemCount: item.quantity
          }
        });
        renderCart();
        flashAddedState(button);
      });
    }
  });
}

function renderReviews(reviews) {
  const feed = document.querySelector("[data-reviews-feed]");
  if (!feed) {
    return;
  }

  if (!reviews.length) {
    feed.innerHTML = `<div class="review-empty">No reviews yet. Be the first customer to share your experience.</div>`;
    return;
  }

  feed.innerHTML = reviews.map((review) => {
    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    return `
      <article class="review-card">
        <div class="review-card__top">
          <div class="review-card__name">${escapeHtml(review.name)}</div>
          <div class="review-card__date">${escapeHtml(formatReviewDate(review.createdAt))}</div>
        </div>
        <div class="review-stars" aria-label="${review.rating} out of 5 stars">${stars}</div>
        <p>${escapeHtml(review.comment)}</p>
        ${review.image ? `<img class="review-card__image" src="${escapeHtml(review.image)}" alt="Review image from ${escapeHtml(review.name)}" loading="lazy" />` : ""}
      </article>
    `;
  }).join("");
}

async function loadReviews() {
  const feed = document.querySelector("[data-reviews-feed]");
  if (!feed) {
    return;
  }

  try {
    const response = await fetch(REVIEWS_API_PATH, {
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load reviews.");
    }

    renderReviews(Array.isArray(payload.reviews) ? payload.reviews : []);
  } catch (_error) {
    feed.innerHTML = `<div class="review-empty">Reviews are temporarily unavailable right now. Please try again shortly.</div>`;
  }
}

function loadReviewsWhenNeeded() {
  if (reviewsLoadPromise) {
    return reviewsLoadPromise;
  }

  const feed = document.querySelector("[data-reviews-feed]");

  if (!feed) {
    return Promise.resolve();
  }

  const shouldLoadImmediately = window.location.hash === "#reviews"
    || feed.getBoundingClientRect().top < (window.innerHeight * 1.2);

  if (shouldLoadImmediately || !("IntersectionObserver" in window)) {
    reviewsLoadPromise = loadReviews();
    return reviewsLoadPromise;
  }

  reviewsLoadPromise = new Promise((resolve) => {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }

      observer.disconnect();
      Promise.resolve(loadReviews()).finally(resolve);
    }, {
      rootMargin: "320px 0px"
    });

    observer.observe(feed);
  });

  return reviewsLoadPromise;
}

function bindReviewForm() {
  if (reviewFormBound) {
    return;
  }

  const form = document.querySelector("[data-review-form]");
  const message = document.querySelector("[data-review-message]");
  const submit = document.querySelector("[data-review-submit]");

  if (!form || !message || !submit) {
    return;
  }

  reviewFormBound = true;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    message.textContent = "Submitting review...";
    message.className = "review-message";
    submit.disabled = true;

    try {
      const formData = new FormData(form);
      const imageInput = form.querySelector('input[name="image"]');
      const imageFile = imageInput && imageInput.files ? imageInput.files[0] : null;
      const payload = {
        name: String(formData.get("name") || "").trim(),
        rating: Number(formData.get("rating")),
        comment: String(formData.get("comment") || "").trim(),
        image: await readReviewImage(imageFile)
      };

      const response = await fetch(REVIEWS_API_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to submit review.");
      }

      form.reset();
      message.textContent = "Thank you. Your review has been added.";
      message.className = "review-message is-success";
      await loadReviews();
    } catch (error) {
      message.textContent = error && error.message ? error.message : "Unable to submit review.";
      message.className = "review-message is-error";
    } finally {
      submit.disabled = false;
    }
  });
}

function bindReferralForm() {
  if (referralFormBound) {
    return;
  }

  const message = document.querySelector("[data-referral-message]");
  const submit = document.querySelector("[data-referral-submit]");
  const output = document.querySelector("[data-referral-output]");
  const codeEl = document.querySelector("[data-referral-code]");
  const linkEl = document.querySelector("[data-referral-link]");
  const copyButton = document.querySelector("[data-copy-referral-link]");
  const lookupInput = document.querySelector("[data-referral-lookup-code]");
  const lookupButton = document.querySelector("[data-check-referral]");
  const rewardsPanel = document.querySelector("[data-referral-status]");

  if (!message || !submit || !output || !linkEl) {
    return;
  }

  referralFormBound = true;

  const getReferralLinkText = () => linkEl.textContent.trim();

  const copyReferralLink = async () => {
    const link = getReferralLinkText();

    if (!link) {
      return false;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
      return true;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(linkEl);
    selection.removeAllRanges();
    selection.addRange(range);

    try {
      return document.execCommand("copy");
    } finally {
      selection.removeAllRanges();
    }
  };

  syncHomepageReferralUi();

  if (lookupInput && lookupInput.dataset.inputBound !== "true") {
    lookupInput.dataset.inputBound = "true";
    lookupInput.addEventListener("input", () => {
      lookupInput.value = normalizeClientReferralCode(lookupInput.value);
    });
  }

  if (submit.dataset.clickBound !== "true") {
    submit.dataset.clickBound = "true";
    submit.addEventListener("click", async (event) => {
      event.preventDefault();
      message.textContent = "Creating referral link...";
      message.className = "referral-message";
      submit.disabled = true;

      try {
        const ownedReferral = getLatestOwnedReferral(true, { allowLegacyCode: true });
        const response = await fetch(REFERRALS_API_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ownerToken: ownedReferral ? ownedReferral.ownerToken : ""
          })
        });
        const result = await response.json();
        const normalizedCode = normalizeClientReferralCode(
          result && result.referral && result.referral.code ? result.referral.code : ""
        );

        if (!response.ok || !result.referral || !isFourDigitClientReferralCode(normalizedCode)) {
          throw new Error(result.error || "Unable to create referral link.");
        }

        const normalizedReferral = {
          ...result.referral,
          code: normalizedCode,
          link: buildClientReferralLink(normalizedCode)
        };

        storeOwnedReferral(normalizedReferral);
        setStoredReferralLookupCode(normalizedCode);
        syncHomepageReferralUi();
        output.scrollIntoView({ behavior: "smooth", block: "nearest" });
        message.textContent = "Referral link ready below.";
        message.className = "referral-message is-success";
        refreshOwnedReferralRewardsIfNeeded(true);
      } catch (error) {
        message.textContent = error && error.message ? error.message : "Unable to create referral link.";
        message.className = "referral-message is-error";
      } finally {
        submit.disabled = false;
      }
    });
  }

  if (copyButton) {
    if (copyButton.dataset.clickBound !== "true") {
      copyButton.dataset.clickBound = "true";
      copyButton.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          const copied = await copyReferralLink();

          if (!copied) {
            throw new Error("Unable to copy referral link.");
          }

          message.textContent = "Referral link copied.";
          message.className = "referral-message is-success";
        } catch (_error) {
          message.textContent = "Unable to copy automatically. You can still select the link and share it manually.";
          message.className = "referral-message is-error";
        }
      });
    }
  }

  if (lookupButton && lookupInput) {
    if (lookupButton.dataset.clickBound !== "true") {
      lookupButton.dataset.clickBound = "true";
      lookupButton.addEventListener("click", async (event) => {
        event.preventDefault();
        message.textContent = "Checking referral rewards...";
        message.className = "referral-message";

        try {
          const referral = await fetchReferralStatusByCode(lookupInput.value);
          lookupInput.value = referral.code || "";
          setStoredReferralLookupCode(referral.code || "");
          renderHomepageReferralStatus(referral);
          message.textContent = "Referral rewards loaded.";
          message.className = "referral-message is-success";
        } catch (error) {
          renderHomepageReferralStatus(null);
          message.textContent = error && error.message ? error.message : "Unable to load referral rewards.";
          message.className = "referral-message is-error";
        }
      });
    }
  }
}

function rebindInteractiveSections() {
  bindPrimaryCtas();
  bindProductCards();
  bindPartyForms();
  bindCartTrigger();
  syncCartTriggerState();

  if (cartUiPrepared) {
    bindCartUI();
    renderCart();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  injectNavMenuStyles();
  injectResponsiveStabilityStyles();
  clearLegacyStorageIfNeeded();
  captureReferralCode();
  bindNavMenus();
  bindPrimaryCtas();
  bindReferralForm();
  syncCartTriggerState();
  revealPageWhenCriticalImagesReady();
  bindProductCards();
  bindPartyForms();
  bindCartTrigger();

  runWhenElementNearViewport("#order-now", () => {
    bindProductCards();
    bindPartyForms();
  }, {
    rootMargin: "520px 0px",
    hash: "#order-now"
  });

  runWhenElementNearViewport("#reviews", () => {
    bindReviewForm();
    loadReviewsWhenNeeded();
  }, {
    rootMargin: "320px 0px",
    hash: "#reviews"
  });

  runNonCriticalTask(() => {
    const pageCategory = getPageCategory();

    trackAnalyticsEvent("page_view");
    if (pageCategory.startsWith("group_")) {
      trackAnalyticsEvent("product_view", {
        metadata: {
          productId: pageCategory
        }
      });
    }
  }, 900);

  runNonCriticalTask(() => {
    enhanceVarietyImages();
  }, 1400);

  runNonCriticalTask(() => {
    refreshPendingPaymentStatusIfNeeded(false);
  }, 1200);
});

window.addEventListener("pageshow", () => {
  syncCartDrawerWithHistoryState();
  rebindInteractiveSections();
  refreshOwnedReferralRewardsIfNeeded(true);
  void refreshPendingPaymentStatusIfNeeded(true);
});

window.addEventListener("pagehide", () => {
  syncCartDrawerWithHistoryState();
});

window.addEventListener("storage", (event) => {
  if (isCartRelatedStorageKey(event.key)) {
    renderCart();
  }

  if (isReferralRelatedStorageKey(event.key)) {
    syncHomepageReferralUi();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    syncCartDrawerWithHistoryState();
    return;
  }

  if (document.visibilityState === "visible") {
    refreshOwnedReferralRewardsIfNeeded(true);
    void refreshPendingPaymentStatusIfNeeded(true);
  }
});

window.addEventListener("popstate", (event) => {
  syncCartDrawerWithHistoryState(event.state);
});
