"use strict";

const CART_STORAGE_KEY = "durianParadiseCart";
const REVIEWS_API_PATH = "/api/reviews";
const PAYMENT_ORDERS_API_PATH = "/api/payment-orders";
const REFERRALS_API_PATH = "/api/referrals";
const REFERRAL_REWARDS_LOOKUP_API_PATH = "/api/referral-rewards/lookup";
const ANALYTICS_EVENTS_API_PATH = "/api/analytics/events";
const PENDING_PAYMENT_STORAGE_KEY = "durianParadisePendingPayment";
const REFERRAL_STORAGE_KEY = "durianParadiseReferral";
const OWNED_REFERRALS_STORAGE_KEY = "durianParadiseOwnedReferrals";
const VISITOR_STORAGE_KEY = "durianParadiseVisitorId";
let phoneMatchedReferralRewards = [];
let referralRewardLookupTimer = 0;
let lastReferralRewardLookupKey = "";
let reviewsLoadPromise = null;
let lastOwnedReferralRefreshAt = 0;

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
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function loadPendingPayment() {
  try {
    const raw = localStorage.getItem(PENDING_PAYMENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function savePendingPayment(payment) {
  localStorage.setItem(PENDING_PAYMENT_STORAGE_KEY, JSON.stringify(payment));
}

function clearPendingPayment() {
  localStorage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
}

function createBrowserId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getVisitorId() {
  try {
    const existing = String(localStorage.getItem(VISITOR_STORAGE_KEY) || "").trim();
    if (existing) {
      return existing;
    }

    const nextId = createBrowserId();
    localStorage.setItem(VISITOR_STORAGE_KEY, nextId);
    return nextId;
  } catch (_error) {
    return createBrowserId();
  }
}

function loadOwnedReferrals() {
  try {
    const raw = localStorage.getItem(OWNED_REFERRALS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function saveOwnedReferrals(referrals) {
  localStorage.setItem(OWNED_REFERRALS_STORAGE_KEY, JSON.stringify(referrals));
}

function storeOwnedReferral(referral) {
  if (!referral || !referral.code || !referral.ownerToken) {
    return;
  }

  const ownedReferrals = loadOwnedReferrals();
  const nextEntry = {
    code: String(referral.code),
    ownerToken: String(referral.ownerToken),
    link: String(referral.link || ""),
    expiresAt: String(referral.expiresAt || ""),
    conversionCount: Number(referral.conversionCount || 0),
    rewards: Array.isArray(referral.rewards) ? referral.rewards : []
  };
  const existingIndex = ownedReferrals.findIndex((entry) => entry.code === nextEntry.code);

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

function getReferralRewardMessage(reward) {
  if (reward && reward.message) {
    return String(reward.message);
  }

  if (reward && reward.type === "free_group1_box") {
    return "You received a free box for referring a friend.";
  }

  if (reward && Number(reward.discountAmount || 0) >= 1000) {
    return "You received a $10 reward for referring a friend.";
  }

  return "You received a $5 reward for referring a friend.";
}

function getActiveOwnedReferralRewards() {
  return loadOwnedReferrals().reduce((result, referral) => {
    const rewards = Array.isArray(referral.rewards) ? referral.rewards : [];

    rewards.forEach((reward) => {
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
  return mergeReferralRewards([
    getActiveOwnedReferralRewards(),
    phoneMatchedReferralRewards
  ]);
}

function normalizePhoneLookupKey(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) {
    return "";
  }

  return digits.length >= 8 ? digits.slice(-8) : digits;
}

function updateReferralRewardsStatus(message = "", isError = false) {
  const status = document.querySelector("[data-referral-rewards-status]");

  if (!status) {
    return;
  }

  status.textContent = message;
  status.classList.toggle("is-error", Boolean(isError && message));
}

async function lookupReferralRewardsByPhone(phone) {
  const lookupKey = normalizePhoneLookupKey(phone);

  if (!lookupKey) {
    lastReferralRewardLookupKey = "";
    phoneMatchedReferralRewards = [];
    updateReferralRewardsStatus("");
    renderCart();
    return;
  }

  lastReferralRewardLookupKey = lookupKey;
  updateReferralRewardsStatus("Checking referral rewards for this number...");

  try {
    const response = await fetch(REFERRAL_REWARDS_LOOKUP_API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });
    const payload = await response.json().catch(() => ({}));

    if (lastReferralRewardLookupKey !== lookupKey) {
      return;
    }

    if (!response.ok) {
      throw new Error(payload.error || "Unable to check referral rewards right now.");
    }

    phoneMatchedReferralRewards = Array.isArray(payload.rewards) ? payload.rewards : [];

    if (!phoneMatchedReferralRewards.length) {
      updateReferralRewardsStatus("No referral rewards are currently waiting for this contact number.");
    } else if (phoneMatchedReferralRewards.length === 1) {
      updateReferralRewardsStatus("1 referral reward is ready and will be applied at checkout.");
    } else {
      updateReferralRewardsStatus(`${phoneMatchedReferralRewards.length} referral rewards are ready and will be applied at checkout.`);
    }

    renderCart();
  } catch (error) {
    if (lastReferralRewardLookupKey !== lookupKey) {
      return;
    }

    phoneMatchedReferralRewards = [];
    updateReferralRewardsStatus(
      error && error.message ? error.message : "Unable to check referral rewards right now.",
      true
    );
    renderCart();
  }
}

function scheduleReferralRewardsLookup(phone) {
  window.clearTimeout(referralRewardLookupTimer);
  referralRewardLookupTimer = window.setTimeout(() => {
    lookupReferralRewardsByPhone(phone);
  }, 220);
}

async function refreshOwnedReferralRewards() {
  const ownedReferrals = loadOwnedReferrals().filter((entry) => entry.code && entry.ownerToken);

  if (!ownedReferrals.length) {
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

      return {
        ...entry,
        ...payload.referral
      };
    } catch (_error) {
      return entry;
    }
  }));

  saveOwnedReferrals(updatedReferrals);
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
    const raw = localStorage.getItem(REFERRAL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || !parsed.code || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
      localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return "";
    }

    return String(parsed.code);
  } catch (_error) {
    localStorage.removeItem(REFERRAL_STORAGE_KEY);
    return "";
  }
}

function captureReferralCode() {
  const params = new URLSearchParams(window.location.search);
  const code = String(params.get("ref") || "").trim();

  if (!code) {
    return;
  }

  localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify({
    code,
    expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000)
  }));
}

function clearStoredReferralCode() {
  localStorage.removeItem(REFERRAL_STORAGE_KEY);
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
  const activeRewards = Array.isArray(rewards) ? rewards : [];
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
  button.textContent = "Added";
  button.disabled = true;

  window.setTimeout(() => {
    button.textContent = originalText;
    const card = button.closest("[data-product-card], [data-party-form]");
    const select = card && (card.querySelector("[data-variant-select]") || card.querySelector("[data-party-select]"));
    const option = select && select.options ? select.options[select.selectedIndex] : null;
    button.disabled = !option || !option.value;
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
    .topbar-inner {
      padding-right: 158px;
    }

    .header-cart-trigger {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid rgba(120, 100, 76, 0.2);
      background: rgba(252, 249, 245, 0.92);
      color: #2d241c;
      border-radius: 999px;
      padding: 11px 16px;
      font-family: "Inter", sans-serif;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 20px rgba(88, 66, 38, 0.08);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      z-index: 2;
    }

    .header-cart-trigger:hover {
      transform: translateY(calc(-50% - 1px));
      box-shadow: 0 14px 28px rgba(88, 66, 38, 0.12);
    }

    .header-cart-badge {
      min-width: 26px;
      height: 26px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #6f5330 0%, #9d7741 100%);
      color: #fffaf1;
      font-size: 13px;
      padding: 0 8px;
    }

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

    .payment-order-line small {
      display: block;
      color: #6a5845;
      margin-top: 3px;
      line-height: 1.35;
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

    .nav-group.is-open .nav-menu {
      display: grid !important;
      gap: 8px;
    }

    .nav-toggle {
      touch-action: manipulation;
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

    @media (max-width: 980px) {
      .topbar-inner {
        padding-right: 0;
      }

      .header-cart-trigger {
        position: static;
        transform: none;
        order: 0;
        flex: 0 0 auto;
        margin-left: auto;
        padding: 9px 12px;
        font-size: 13px;
        gap: 8px;
      }

      .header-cart-trigger:hover {
        transform: translateY(-1px);
      }
    }

    @media (max-width: 820px) {
      .nav-group {
        position: static !important;
        padding-bottom: 0 !important;
        margin-bottom: 0 !important;
      }

      .nav-group.is-open .nav-menu {
        position: static !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
        transform: none !important;
        width: min(320px, calc(100vw - 32px));
        margin: 10px auto 0;
      }
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

  window.requestAnimationFrame(revealPage);
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

function bindNavMenus() {
  const navGroups = document.querySelectorAll(".nav-group");
  if (!navGroups.length) {
    return;
  }

  const closeAllNavMenus = () => {
    navGroups.forEach((group) => {
      group.classList.remove("is-open");
      const toggle = group.querySelector(".nav-toggle");
      if (toggle) {
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  };

  navGroups.forEach((group) => {
    const toggle = group.querySelector(".nav-toggle");
    if (!toggle) {
      return;
    }

    toggle.setAttribute("aria-expanded", "false");

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = group.classList.contains("is-open");
      closeAllNavMenus();

      if (!isOpen) {
        group.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
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
  const isMobile = window.matchMedia("(max-width: 640px)").matches;
  const wrapImages = () => {
    document.querySelectorAll(".variety-gallery img").forEach((img) => {
      if (!img.hasAttribute("loading")) {
        img.loading = "lazy";
      }

      if (!img.hasAttribute("decoding")) {
        img.decoding = "async";
      }

      if (isMobile) {
        return;
      }

      if (img.parentElement && img.parentElement.classList.contains("smart-image-frame")) {
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "smart-image-frame";
      wrapper.style.setProperty("--image-src", `url("${img.getAttribute("src")}")`);
      img.classList.add("smart-image-fg");

      img.parentNode.insertBefore(wrapper, img);
      wrapper.appendChild(img);
    });
  };

  if (isMobile) {
    wrapImages();
    return;
  }

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(wrapImages, { timeout: 900 });
  } else {
    window.setTimeout(wrapImages, 120);
  }
}

function ensureCartUI() {
  injectCartStyles();

  const topbarInner = document.querySelector(".topbar-inner");
  if (topbarInner && !topbarInner.querySelector("[data-cart-trigger]")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "header-cart-trigger";
    button.setAttribute("data-cart-trigger", "");
    button.setAttribute("aria-controls", "cart-drawer");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<span>View Cart</span><span class="header-cart-badge" data-cart-count>0</span>';
    topbarInner.appendChild(button);
  }

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
        <div class="checkout-details">
          <h3>Delivery Details</h3>
          <div class="checkout-field">
            <label for="checkout-name">Name</label>
            <input id="checkout-name" type="text" maxlength="80" autocomplete="name" data-checkout-name />
          </div>
          <div class="checkout-field">
            <label for="checkout-phone">Contact Number</label>
            <input id="checkout-phone" type="tel" maxlength="40" autocomplete="tel" data-checkout-phone required />
          </div>
          <div class="checkout-field">
            <label for="checkout-email">Email</label>
            <input id="checkout-email" type="email" maxlength="120" autocomplete="email" data-checkout-email required />
          </div>
          <div class="checkout-field">
            <label for="checkout-address">Delivery Address</label>
            <textarea id="checkout-address" maxlength="260" autocomplete="street-address" data-checkout-address required></textarea>
          </div>
        </div>
        <p class="checkout-note">Enter your delivery details, then create your PayNow to UEN No payment reference.</p>
        <button class="checkout-button" type="button" data-cart-checkout disabled>PayNow to UEN No</button>
        <div data-payment-request></div>
      </div>
    `;
    document.body.appendChild(drawer);
  }
}

function openCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  const trigger = document.querySelector("[data-cart-trigger]");

  if (!drawer || !overlay || !trigger) {
    return;
  }

  drawer.classList.add("is-open");
  overlay.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  trigger.setAttribute("aria-expanded", "true");
  refreshOwnedReferralRewardsIfNeeded();
}

function closeCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  const overlay = document.getElementById("cart-overlay");
  const trigger = document.querySelector("[data-cart-trigger]");

  if (!drawer || !overlay || !trigger) {
    return;
  }

  drawer.classList.remove("is-open");
  overlay.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  trigger.setAttribute("aria-expanded", "false");
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

function renderPaymentRequestCard(pendingPayment) {
  if (!pendingPayment) {
    return "";
  }

  const order = pendingPayment.order || {};
  const customer = order.customer || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const hasMarkedPaid = order.status === "customer_marked_paid" || Boolean(order.customerPaymentAcknowledgement);
  const breakdown = order.summary && order.summary.priceBreakdown ? order.summary.priceBreakdown : null;
  const orderLines = items.length ? items.map((item) => `
    <div class="payment-order-line">
      <div>
        <strong>${escapeHtml(item.name || "Durian item")}</strong>
        <small>${escapeHtml(item.variantLabel || "")} &middot; Qty ${escapeHtml(item.quantity || 1)}</small>
      </div>
      <strong>${escapeHtml(formatCurrency(Number(item.subtotalAmount || 0) / 100))}</strong>
    </div>
  `).join("") : "";

  return `
    <div class="payment-request-card">
      <h3>PayNow to UEN No</h3>
      <div class="payment-request-total">
        <span>Amount To Pay Now</span>
        <strong>${escapeHtml(pendingPayment.amountDisplay || order.summary?.totalDisplay || "")}</strong>
      </div>
      ${breakdown ? renderCartBreakdown(breakdown, true) : ""}
      <div class="payment-detail-grid">
        <div class="payment-detail">
          <span>PayNow UEN No</span>
          <strong>${escapeHtml(pendingPayment.paynowToUen || "")}</strong>
        </div>
        <div class="payment-detail">
          <span>Ticket / Order No</span>
          <strong>${escapeHtml(pendingPayment.reference || order.id || "")}</strong>
        </div>
        <div class="payment-detail">
          <span>Email</span>
          <strong>${escapeHtml(customer.email || "")}</strong>
        </div>
        <div class="payment-detail">
          <span>Contact</span>
          <strong>${escapeHtml(customer.phone || "")}</strong>
        </div>
        <div class="payment-detail" style="grid-column: 1 / -1;">
          <span>Delivery Address</span>
          <strong>${escapeHtml(customer.address || "")}</strong>
        </div>
      </div>
      ${orderLines ? `<div class="payment-order-summary"><h3>Order Summary</h3>${orderLines}</div>` : ""}
      <p>${escapeHtml(pendingPayment.message || "")}</p>
      ${hasMarkedPaid ? `<p><strong>Payment acknowledgement received.</strong> Durian Paradise will verify the bank transfer using your ticket number.</p>` : ""}
      <div class="payment-request-actions">
        <button class="payment-request-paid" type="button" data-mark-payment-paid ${hasMarkedPaid ? "disabled" : ""}>${hasMarkedPaid ? "Paid Acknowledgement Sent" : "I Have Paid"}</button>
        <button class="payment-request-copy" type="button" data-copy-payment-reference>Copy UEN, amount & ticket no</button>
        <button class="payment-request-clear" type="button" data-clear-payment-request>Clear payment note</button>
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
  const pendingPayment = loadPendingPayment();
  const pricing = applyReferralRewardsToPricing(calculateCartPricing(cart), activeReferralRewards);

  countEls.forEach((el) => {
    el.textContent = String(getCartCount(cart));
  });

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
}

function bindCartUI() {
  const trigger = document.querySelector("[data-cart-trigger]");
  const overlay = document.querySelector("[data-cart-overlay]");
  const close = document.querySelector("[data-cart-close]");
  const body = document.querySelector("[data-cart-body]");
  const checkout = document.querySelector("[data-cart-checkout]");
  const paymentRequest = document.querySelector("[data-payment-request]");
  const phoneInput = document.querySelector("[data-checkout-phone]");

  if (trigger) {
    trigger.addEventListener("click", openCartDrawer);
  }

  if (overlay) {
    overlay.addEventListener("click", closeCartDrawer);
  }

  if (close) {
    close.addEventListener("click", closeCartDrawer);
  }

  if (body) {
    body.addEventListener("click", (event) => {
      const item = event.target.closest("[data-cart-item-key]");
      if (!item) {
        return;
      }

      const itemKey = item.getAttribute("data-cart-item-key");

      if (event.target.matches("[data-cart-increase]")) {
        updateCartQuantity(itemKey, 1);
        renderCart();
        return;
      }

      if (event.target.matches("[data-cart-decrease]")) {
        updateCartQuantity(itemKey, -1);
        renderCart();
        return;
      }

      if (event.target.matches("[data-cart-remove]")) {
        removeCartItem(itemKey);
        renderCart();
      }
    });
  }

  if (paymentRequest) {
    paymentRequest.addEventListener("click", async (event) => {
      if (event.target.matches("[data-clear-payment-request]")) {
        clearPendingPayment();
        renderCart();
      }

      if (event.target.matches("[data-mark-payment-paid]")) {
        const pendingPayment = loadPendingPayment();
        const orderId = pendingPayment && (pendingPayment.reference || (pendingPayment.order && pendingPayment.order.id));

        if (!pendingPayment || !orderId) {
          return;
        }

        event.target.disabled = true;
        event.target.textContent = "Sending...";

        try {
          const response = await fetch(`${PAYMENT_ORDERS_API_PATH}/${encodeURIComponent(orderId)}/paid`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({})
          });
          const payload = await response.json();

          if (!response.ok || !payload.order) {
            throw new Error(payload.error || "Unable to mark payment as paid.");
          }

          savePendingPayment({
            ...pendingPayment,
            order: payload.order,
            paymentMarkedPaid: true
          });
          renderCart();
        } catch (error) {
          window.alert(error && error.message ? error.message : "Unable to mark payment as paid.");
          event.target.disabled = false;
          event.target.textContent = "I Have Paid";
        }
      }

      if (event.target.matches("[data-copy-payment-reference]")) {
        const pendingPayment = loadPendingPayment();
        if (!pendingPayment || !navigator.clipboard) {
          return;
        }
        const order = pendingPayment.order || {};
        const customer = order.customer || {};

        navigator.clipboard.writeText(
          `PayNow UEN: ${pendingPayment.paynowToUen || ""}\nAmount: ${pendingPayment.amountDisplay || ""}\nTicket / Order No: ${pendingPayment.reference || ""}\nEmail: ${customer.email || ""}\nContact: ${customer.phone || ""}\nAddress: ${customer.address || ""}`
        );
      }
    });
  }

  if (phoneInput) {
    const syncReferralLookup = () => {
      scheduleReferralRewardsLookup(phoneInput.value.trim());
    };

    phoneInput.addEventListener("input", syncReferralLookup);
    phoneInput.addEventListener("blur", syncReferralLookup);

    if (phoneInput.value.trim()) {
      syncReferralLookup();
    }
  }

  if (checkout) {
    checkout.addEventListener("click", async () => {
      const cart = loadCart();
      const activeReferralRewards = getDisplayableReferralRewards();
      const referralRewardClaims = activeReferralRewards.map((reward) => ({
        referralCode: reward.referralCode,
        rewardId: reward.id,
        ownerToken: reward.ownerToken
      })).filter((claim) => claim.referralCode && claim.rewardId && claim.ownerToken);
      const nameInput = document.querySelector("[data-checkout-name]");
      const phoneInput = document.querySelector("[data-checkout-phone]");
      const emailInput = document.querySelector("[data-checkout-email]");
      const addressInput = document.querySelector("[data-checkout-address]");
      const notesInput = document.querySelector("[data-checkout-notes]");
      const phone = phoneInput ? phoneInput.value.trim() : "";
      const email = emailInput ? emailInput.value.trim() : "";
      const address = addressInput ? addressInput.value.trim() : "";

      if (!cart.length) {
        return;
      }

      if (!phone) {
        window.alert("Please enter your contact number before payment.");
        if (phoneInput) {
          phoneInput.focus();
        }
        return;
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        window.alert("Please enter a valid email address for your order confirmation.");
        if (emailInput) {
          emailInput.focus();
        }
        return;
      }

      if (!address) {
        window.alert("Please enter your delivery address before payment.");
        if (addressInput) {
          addressInput.focus();
        }
        return;
      }

      trackAnalyticsEvent("checkout_started", {
        metadata: {
          itemCount: getCartCount(cart)
        }
      });

      checkout.disabled = true;
      checkout.textContent = "Creating PayNow Order...";

      try {
        const response = await fetch(PAYMENT_ORDERS_API_PATH, {
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
            customer: {
              name: nameInput ? nameInput.value.trim() : "",
              phone,
              email,
              address,
              deliveryNotes: notesInput ? notesInput.value.trim() : ""
            },
            referralCode: getStoredReferralCode(),
            referralRewardClaims,
            visitorId: getVisitorId(),
            path: window.location.pathname,
            pageCategory: getPageCategory()
          })
        });

        const payload = await response.json();

        if (!response.ok || !payload.order || !payload.paymentRequest) {
          throw new Error(payload.error || "Unable to create payment order.");
        }

        saveCart([]);
        savePendingPayment({
          ...payload.paymentRequest,
          order: payload.order
        });
        clearStoredReferralCode();
        markOwnedReferralRewardsAsClaimed(referralRewardClaims, payload.order.id);
        phoneMatchedReferralRewards = [];
        updateReferralRewardsStatus("");
        renderCart();
        const updatedPaymentRequest = document.querySelector("[data-payment-request]");
        if (updatedPaymentRequest) {
          updatedPaymentRequest.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        checkout.disabled = false;
        checkout.textContent = "PayNow to UEN No";
      } catch (error) {
        window.alert(error && error.message ? error.message : "Unable to create payment order.");
        checkout.disabled = false;
        checkout.textContent = "PayNow to UEN No";
      }
    });
  }
}

function bindProductCards() {
  document.querySelectorAll("[data-product-card]").forEach((card) => {
    const button = card.querySelector("[data-add-product]");
    const details = card.querySelector("[data-multi-option]");
    const summary = card.querySelector("[data-multi-option-summary]");
    const rows = Array.from(card.querySelectorAll("[data-variant-row]"));

    if (!button || !details || !summary || !rows.length) {
      return;
    }

    const syncCardState = () => {
      const selectedRows = rows.filter((row) => Number(row.dataset.quantity || 0) > 0);
      summary.textContent = selectedRows.length
        ? selectedRows.map((row) => `${row.dataset.variantValue} x${row.dataset.quantity}`).join(", ")
        : "Choose option(s)";
      button.disabled = selectedRows.length === 0;
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

      if (decrease) {
        decrease.addEventListener("click", (event) => {
          event.preventDefault();
          updateQty(Number(row.dataset.quantity || 0) - 1);
        });
      }

      if (increase) {
        increase.addEventListener("click", (event) => {
          event.preventDefault();
          updateQty(Number(row.dataset.quantity || 0) + 1);
        });
      }

      updateQty(Number(row.dataset.quantity || 0));
    });

    document.addEventListener("click", (event) => {
      if (!details.contains(event.target)) {
        details.removeAttribute("open");
      }
    });

    syncCardState();
    button.textContent = "Add to Cart";

    button.addEventListener("click", () => {
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
          quantity: Number(row.dataset.quantity || 0),
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
    });
  });
}

function bindPartyForms() {
  document.querySelectorAll("[data-party-form]").forEach((form) => {
    const select = form.querySelector("[data-party-select]");
    const button = form.querySelector("[data-add-party]");

    if (!select || !button) {
      return;
    }

    const syncPartyButton = () => {
      const option = select.options[select.selectedIndex];
      button.disabled = !option || !option.value;
    };

    syncPartyButton();
    select.addEventListener("change", syncPartyButton);
    button.textContent = "Add to Cart";

    button.addEventListener("click", () => {
      const option = select.options[select.selectedIndex];
      if (!option || !option.value) {
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
  const form = document.querySelector("[data-review-form]");
  const message = document.querySelector("[data-review-message]");
  const submit = document.querySelector("[data-review-submit]");

  if (!form || !message || !submit) {
    return;
  }

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
  const message = document.querySelector("[data-referral-message]");
  const submit = document.querySelector("[data-referral-submit]");
  const output = document.querySelector("[data-referral-output]");
  const linkEl = document.querySelector("[data-referral-link]");
  const copyButton = document.querySelector("[data-copy-referral-link]");
  const checkoutPhoneInput = document.querySelector("[data-checkout-phone]");

  if (!message || !submit || !output || !linkEl) {
    return;
  }

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

  submit.addEventListener("click", async () => {
    message.textContent = "Creating referral link...";
    message.className = "referral-message";
    submit.disabled = true;

    try {
      const ownerPhone = checkoutPhoneInput ? checkoutPhoneInput.value.trim() : "";
      const response = await fetch(REFERRALS_API_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ownerPhone
        })
      });
      const result = await response.json();

      if (!response.ok || !result.referral || !result.referral.link) {
        throw new Error(result.error || "Unable to create referral link.");
      }

      storeOwnedReferral(result.referral);
      linkEl.textContent = result.referral.link;
      output.classList.add("is-visible");
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

  if (copyButton) {
    copyButton.addEventListener("click", async () => {
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

document.addEventListener("DOMContentLoaded", () => {
  captureReferralCode();
  trackAnalyticsEvent("page_view");
  if (getPageCategory().startsWith("group_")) {
    trackAnalyticsEvent("product_view", {
      metadata: {
        productId: getPageCategory()
      }
    });
  }
  ensureCartUI();
  bindNavMenus();
  enhanceVarietyImages();
  bindCartUI();
  bindProductCards();
  bindPartyForms();
  renderCart();
  bindReviewForm();
  bindReferralForm();
  revealPageWhenCriticalImagesReady();
  runNonCriticalTask(() => {
    loadReviewsWhenNeeded();
  }, 700);
});
