"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const port = process.env.PORT || 3000;
const siteUrl = process.env.SITE_URL || "https://www.durianparadises.com";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const reviewsPath = process.env.REVIEWS_FILE_PATH || path.join(__dirname, "reviews.json");
const ordersPath = process.env.ORDERS_FILE_PATH || path.join(__dirname, "orders.json");
const referralsPath = process.env.REFERRALS_FILE_PATH || path.join(__dirname, "referrals.json");
const analyticsPath = process.env.ANALYTICS_FILE_PATH || path.join(__dirname, "analytics.json");
const businessUen = process.env.BUSINESS_UEN || "53490378M";
const paymentProvider = process.env.PAYMENT_PROVIDER || "pending_dynamic_sgqr";
const paymentProviderName = process.env.PAYMENT_PROVIDER_NAME || "PayNow / SGQR";
const resendApiKey = process.env.RESEND_API_KEY || "";
const orderEmailFrom = process.env.ORDER_EMAIL_FROM || "Durian Paradise <orders@durianparadises.com>";
const orderEmailReplyTo = process.env.ORDER_EMAIL_REPLY_TO || "durianparadise6940@gmail.com";
const orderNotificationEmail = process.env.ORDER_NOTIFICATION_EMAIL || "durianparadise6940@gmail.com";
const analyticsAuthUser = process.env.ANALYTICS_AUTH_USER || "";
const analyticsAuthPassword = process.env.ANALYTICS_AUTH_PASSWORD || "";
const allowedAnalyticsTypes = new Set([
  "page_view",
  "product_view",
  "add_to_cart",
  "checkout_started",
  "order_created",
  "payment_marked_paid",
  "referral_click"
]);
const blockedStaticPaths = new Set([
  "/analytics.json",
  "/orders.json",
  "/referrals.json",
  "/server.out.log",
  "/server.err.log",
  "/server.js",
  "/package.json",
  "/package-lock.json",
  "/render.yaml",
  "/.env.example",
  "/.gitignore"
]);

const productCatalog = {
  "delivery-group1|650g": {
    name: "Group 1 Durians",
    variantLabel: "650g box",
    unitAmount: 4900,
    orderType: "Online Delivery"
  },
  "delivery-group1|800g": {
    name: "Group 1 Durians",
    variantLabel: "800g box",
    unitAmount: 6000,
    orderType: "Online Delivery"
  },
  "delivery-group2|650g": {
    name: "Group 2 Durians",
    variantLabel: "650g box",
    unitAmount: 6000,
    orderType: "Online Delivery"
  },
  "delivery-group2|800g": {
    name: "Group 2 Durians",
    variantLabel: "800g box",
    unitAmount: 7200,
    orderType: "Online Delivery"
  },
  "delivery-group3|650g": {
    name: "Group 3 Durians",
    variantLabel: "650g box",
    unitAmount: 6500,
    orderType: "Online Delivery"
  },
  "delivery-group3|800g": {
    name: "Group 3 Durians",
    variantLabel: "800g box",
    unitAmount: 7500,
    orderType: "Online Delivery"
  },
  "party-group1|g1-21": {
    name: "Group 1 Durians",
    variantLabel: "8 pax - 21kg (est 11 to 13 durians) at $10/kg",
    unitAmount: 21000,
    orderType: "Durian Party"
  },
  "party-group1|g1-24": {
    name: "Group 1 Durians",
    variantLabel: "13 pax - 24kg (est 14 to 17 durians) at $10/kg",
    unitAmount: 24000,
    orderType: "Durian Party"
  },
  "party-group1|g1-27": {
    name: "Group 1 Durians",
    variantLabel: "18 pax - 27kg (est 16 to 19 durians) at $8/kg",
    unitAmount: 21600,
    orderType: "Durian Party"
  },
  "party-group2|g2-21": {
    name: "Group 2 Durians - Mao Shan Wang",
    variantLabel: "8 pax - 21kg (est 11 to 13 durians) at $16/kg",
    unitAmount: 33600,
    orderType: "Durian Party"
  },
  "party-group2|g2-24": {
    name: "Group 2 Durians - Mao Shan Wang",
    variantLabel: "13 pax - 24kg (est 14 to 17 durians) at $16/kg",
    unitAmount: 38400,
    orderType: "Durian Party"
  },
  "party-group2|g2-27": {
    name: "Group 2 Durians - Mao Shan Wang",
    variantLabel: "18 pax - 27kg (est 16 to 19 durians) at $14/kg",
    unitAmount: 37800,
    orderType: "Durian Party"
  },
  "party-group3|g3-21": {
    name: "Group 3 Durians - Black Gold, Black Thorns Orchee",
    variantLabel: "8 pax - 21kg (est 11 to 13 durians) at $18/kg",
    unitAmount: 37800,
    orderType: "Durian Party"
  },
  "party-group3|g3-24": {
    name: "Group 3 Durians - Black Gold, Black Thorns Orchee",
    variantLabel: "13 pax - 24kg (est 14 to 17 durians) at $18/kg",
    unitAmount: 43200,
    orderType: "Durian Party"
  },
  "party-group3|g3-27": {
    name: "Group 3 Durians - Black Gold, Black Thorns Orchee",
    variantLabel: "18 pax - 27kg (est 16 to 19 durians) at $16/kg",
    unitAmount: 43200,
    orderType: "Durian Party"
  }
};

app.use(express.json({ limit: "3mb" }));

function getBasicAuthCredentials(headerValue) {
  const header = String(headerValue || "");

  if (!header.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch (_error) {
    return null;
  }
}

function requireAnalyticsAuth(req, res, next) {
  if (!analyticsAuthUser || !analyticsAuthPassword) {
    return res.status(503).json({
      error: "Analytics access is disabled until ANALYTICS_AUTH_USER and ANALYTICS_AUTH_PASSWORD are configured."
    });
  }

  const credentials = getBasicAuthCredentials(req.get("authorization"));
  const isAuthorized = credentials
    && credentials.username === analyticsAuthUser
    && credentials.password === analyticsAuthPassword;

  if (isAuthorized) {
    return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Durian Paradise Analytics"');
  return res.status(401).send("Analytics access requires owner credentials.");
}

app.use((req, res, next) => {
  if (blockedStaticPaths.has(req.path)) {
    return res.status(404).send("Not found");
  }

  if (req.path === "/analytics.html" || req.path === "/analytics") {
    return requireAnalyticsAuth(req, res, next);
  }

  return next();
});

app.use(express.static(__dirname));

function ensureJsonFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2) + "\n", "utf8");
  }
}

function ensureJsonArrayFile(filePath) {
  ensureJsonFile(filePath, []);
}

function ensureJsonObjectFile(filePath, defaultValue) {
  ensureJsonFile(filePath, defaultValue);
}

function readReviews() {
  ensureJsonArrayFile(reviewsPath);

  try {
    const raw = fs.readFileSync(reviewsPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeReviews(reviews) {
  ensureJsonArrayFile(reviewsPath);
  fs.writeFileSync(reviewsPath, JSON.stringify(reviews, null, 2) + "\n", "utf8");
}

function readOrders() {
  ensureJsonArrayFile(ordersPath);

  try {
    const raw = fs.readFileSync(ordersPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeOrders(orders) {
  ensureJsonArrayFile(ordersPath);
  fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2) + "\n", "utf8");
}

function readReferrals() {
  ensureJsonArrayFile(referralsPath);

  try {
    const raw = fs.readFileSync(referralsPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeReferrals(referrals) {
  ensureJsonArrayFile(referralsPath);
  fs.writeFileSync(referralsPath, JSON.stringify(referrals, null, 2) + "\n", "utf8");
}

function readAnalytics() {
  ensureJsonObjectFile(analyticsPath, { events: [] });

  try {
    const raw = fs.readFileSync(analyticsPath, "utf8");
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return { events: parsed };
    }

    if (parsed && Array.isArray(parsed.events)) {
      return { events: parsed.events };
    }

    return { events: [] };
  } catch (_error) {
    return { events: [] };
  }
}

function writeAnalytics(analytics) {
  ensureJsonObjectFile(analyticsPath, { events: [] });

  const events = Array.isArray(analytics && analytics.events)
    ? analytics.events.slice(-5000)
    : [];

  fs.writeFileSync(analyticsPath, JSON.stringify({ events }, null, 2) + "\n", "utf8");
}

function makeReferralCode() {
  return `dp-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
}

function makeRecordId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeOwnerToken() {
  return `owner-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

function makeOrderId(existingOrders) {
  const orders = Array.isArray(existingOrders) ? existingOrders : [];
  const highestOrderNumber = orders.reduce((max, order) => {
    const match = /^DP-(\d+)$/.exec(String(order && order.id ? order.id : "").trim());
    if (!match) {
      return max;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 1000);

  return `DP-${highestOrderNumber + 1}`;
}

function getReferralReward(referralCount) {
  const cyclePosition = ((referralCount - 1) % 3) + 1;
  const cycleNumber = Math.floor((referralCount - 1) / 3) + 1;

  if (cyclePosition === 1) {
    return {
      type: "cash_discount",
      label: "$5 discount",
      discountAmount: 500,
      message: "You received a $5 reward for referring a friend.",
      cycleNumber
    };
  }

  if (cyclePosition === 2) {
    return {
      type: "cash_discount",
      label: "$10 discount",
      discountAmount: 1000,
      message: "You received a $10 reward for referring a friend.",
      cycleNumber
    };
  }

  if (cyclePosition === 3) {
    return {
      type: "free_group1_box",
      label: "Free box of Group 1 durians",
      discountAmount: 0,
      message: "You received a free box for referring a friend.",
      cycleNumber
    };
  }

  return null;
}

function sanitizeReferralCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
}

function sanitizeOwnerToken(rawToken) {
  return String(rawToken || "")
    .trim()
    .slice(0, 120);
}

function sanitizeAnalyticsType(rawType) {
  const type = String(rawType || "").trim().toLowerCase();
  return allowedAnalyticsTypes.has(type) ? type : "";
}

function sanitizeAnalyticsPath(rawPath) {
  const pathValue = String(rawPath || "").trim();

  if (!pathValue) {
    return "/";
  }

  return pathValue.slice(0, 160);
}

function sanitizeVisitorId(rawVisitorId) {
  return String(rawVisitorId || "")
    .trim()
    .replace(/[^a-z0-9-]/gi, "")
    .slice(0, 80);
}

function sanitizeText(rawValue, maxLength) {
  return String(rawValue || "").trim().slice(0, maxLength);
}

function buildReferralRewardMessage(reward) {
  if (reward && reward.type === "cash_discount" && Number(reward.discountAmount) === 1000) {
    return "You received a $10 reward for referring a friend.";
  }

  if (reward && reward.type === "free_group1_box") {
    return "You received a free box for referring a friend.";
  }

  return "You received a $5 reward for referring a friend.";
}

function normalizeReferralReward(rawReward) {
  const reward = rawReward && typeof rawReward === "object" ? rawReward : {};
  const legacyText = typeof rawReward === "string"
    ? rawReward
    : String(reward.reward || reward.label || "");

  let type = String(reward.type || "").trim();
  let label = String(reward.label || "").trim();
  let discountAmount = Number(reward.discountAmount || 0);

  if (!type) {
    if (/free/i.test(legacyText)) {
      type = "free_group1_box";
    } else {
      type = "cash_discount";
    }
  }

  if (!label) {
    if (type === "free_group1_box") {
      label = "Free box of Group 1 durians";
    } else {
      label = legacyText.includes("$10") ? "$10 discount" : "$5 discount";
    }
  }

  if (!discountAmount && type === "cash_discount") {
    discountAmount = legacyText.includes("$10") ? 1000 : 500;
  }

  const normalizedReward = {
    id: sanitizeText(reward.id, 80) || makeRecordId("reward"),
    type,
    label,
    discountAmount,
    message: sanitizeText(reward.message, 180) || buildReferralRewardMessage({ type, discountAmount }),
    referralCount: Number(reward.referralCount || 0) || 0,
    referralCycle: Number(reward.referralCycle || 0) || 0,
    orderId: sanitizeText(reward.orderId, 40),
    status: reward.status === "claimed" ? "claimed" : "issued_for_next_purchase",
    createdAt: sanitizeText(reward.createdAt, 40) || new Date().toISOString(),
    claimedAt: sanitizeText(reward.claimedAt, 40) || "",
    claimedOrderId: sanitizeText(reward.claimedOrderId, 40)
  };

  return normalizedReward;
}

function normalizeReferralEntry(referral) {
  if (!referral || typeof referral !== "object") {
    return referral;
  }

  referral.code = sanitizeReferralCode(referral.code);
  referral.ownerToken = sanitizeOwnerToken(referral.ownerToken);
  referral.visitors = Array.isArray(referral.visitors) ? referral.visitors : [];
  referral.conversions = Array.isArray(referral.conversions) ? referral.conversions : [];
  referral.rewards = Array.isArray(referral.rewards) ? referral.rewards.map(normalizeReferralReward) : [];

  return referral;
}

function normalizeReviewImage(rawImage) {
  const image = String(rawImage || "").trim();

  if (!image) {
    return "";
  }

  if (!/^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(image)) {
    throw new Error("Please upload a valid JPG, PNG, or WebP image.");
  }

  if (Buffer.byteLength(image, "utf8") > 2 * 1024 * 1024) {
    throw new Error("Please upload an image smaller than 2MB.");
  }

  return image;
}

function normalizeCartItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];

  if (!items.length) {
    throw new Error("Cart is empty.");
  }

  return items.map((item) => {
    const key = `${item.productId || ""}|${item.variantValue || ""}`;
    const product = productCatalog[key];
    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);

    if (!product) {
      throw new Error(`Unknown cart item: ${key}`);
    }

    return {
      key,
      productId: item.productId,
      variantValue: item.variantValue,
      name: product.name,
      variantLabel: product.variantLabel,
      orderType: product.orderType,
      quantity,
      unitAmount: product.unitAmount,
      subtotalAmount: product.unitAmount * quantity
    };
  });
}

function buildPriceBreakdown(items, claimedReferralRewards = []) {
  const deliveryItems = items.filter((item) => item.orderType === "Online Delivery");
  const partyItems = items.filter((item) => item.orderType !== "Online Delivery");
  const deliveryBoxCount = deliveryItems.reduce((sum, item) => sum + item.quantity, 0);
  const deliverySubtotal = deliveryItems.reduce((sum, item) => sum + item.subtotalAmount, 0);
  const partySubtotal = partyItems.reduce((sum, item) => sum + item.subtotalAmount, 0);
  const minimumDeliveryBoxesMet = deliveryBoxCount === 0 || deliveryBoxCount >= 3;
  const deliveryFee = deliveryBoxCount >= 3 && deliveryBoxCount < 4 ? 2200 : 0;
  const deliveryDiscount = deliveryBoxCount >= 4 ? Math.round(deliverySubtotal * 0.10) : 0;

  const deliveryUnitAmounts = [];
  deliveryItems.forEach((item) => {
    for (let index = 0; index < item.quantity; index += 1) {
      deliveryUnitAmounts.push(item.unitAmount);
    }
  });
  deliveryUnitAmounts.sort((left, right) => left - right);

  const freeBoxCount = Math.floor(deliveryBoxCount / 6);
  const freeBoxDiscount = deliveryUnitAmounts
    .slice(0, freeBoxCount)
    .reduce((sum, amount) => sum + amount, 0);
  const normalizedReferralRewards = (Array.isArray(claimedReferralRewards) ? claimedReferralRewards : [])
    .map(normalizeReferralReward);

  const subtotalBeforeAdjustments = deliverySubtotal + partySubtotal;
  const amountBeforeReferralRewards = subtotalBeforeAdjustments + deliveryFee - deliveryDiscount - freeBoxDiscount;
  const referralCashDiscount = Math.min(
    amountBeforeReferralRewards,
    normalizedReferralRewards
      .filter((reward) => reward.type === "cash_discount")
      .reduce((sum, reward) => sum + Number(reward.discountAmount || 0), 0)
  );
  const referralFreeBoxCount = normalizedReferralRewards
    .filter((reward) => reward.type === "free_group1_box")
    .length;
  const totalAmount = amountBeforeReferralRewards - referralCashDiscount;

  return {
    deliveryBoxCount,
    deliverySubtotal,
    partySubtotal,
    subtotalBeforeAdjustments,
    deliveryFee,
    deliveryDiscount,
    freeBoxCount,
    freeBoxDiscount,
    referralCashDiscount,
    referralFreeBoxCount,
    referralRewardMessages: normalizedReferralRewards.map((reward) => reward.message),
    minimumDeliveryBoxesMet,
    totalAmount,
    notes: [
      "Delivery fee at $22 applies for 3 boxes.",
      "Free delivery and 10% discount apply for 4 boxes and above.",
      "Buy 5 boxes, the 6th box from Group 1 with 500g is free."
    ]
  };
}

function summarizeOrder(items, claimedReferralRewards = []) {
  const priceBreakdown = buildPriceBreakdown(items, claimedReferralRewards);
  const totalAmount = priceBreakdown.totalAmount;

  return {
    currency: "SGD",
    totalAmount,
    totalDisplay: `$${(totalAmount / 100).toFixed(2)}`,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    priceBreakdown
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function formatAmount(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function recordAnalyticsEvent(input) {
  const type = sanitizeAnalyticsType(input && input.type);

  if (!type) {
    return null;
  }

  const analytics = readAnalytics();
  const event = {
    id: makeRecordId("evt"),
    type,
    visitorId: sanitizeVisitorId(input && input.visitorId),
    path: sanitizeAnalyticsPath(input && input.path),
    pageCategory: sanitizeText(input && input.pageCategory, 80),
    referrer: sanitizeText(input && input.referrer, 180),
    userAgent: sanitizeText(input && input.userAgent, 180),
    orderId: sanitizeText(input && input.orderId, 40),
    referralCode: sanitizeReferralCode(input && input.referralCode),
    metadata: input && input.metadata && typeof input.metadata === "object"
      ? {
          productId: sanitizeText(input.metadata.productId, 80),
          variantValue: sanitizeText(input.metadata.variantValue, 80),
          itemCount: Number(input.metadata.itemCount || 0) || 0
        }
      : {},
    createdAt: new Date().toISOString()
  };

  analytics.events.push(event);
  writeAnalytics(analytics);
  return event;
}

function buildAnalyticsSummary(days) {
  const analytics = readAnalytics();
  const requestedDays = Math.max(1, Math.min(365, parseInt(days, 10) || 30));
  const since = new Date(Date.now() - (requestedDays * 24 * 60 * 60 * 1000));
  const events = analytics.events.filter((event) => {
    const createdAt = new Date(event.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= since.getTime();
  });
  const byType = events.reduce((summary, event) => {
    summary[event.type] = (summary[event.type] || 0) + 1;
    return summary;
  }, {});
  const uniqueVisitors = new Set(
    events
      .map((event) => event.visitorId)
      .filter(Boolean)
  );
  const pageStats = new Map();

  events.forEach((event) => {
    const pageKey = event.path || "/";

    if (!pageStats.has(pageKey)) {
      pageStats.set(pageKey, {
        path: pageKey,
        pageViews: 0,
        productViews: 0,
        addToCart: 0,
        checkoutStarts: 0,
        ordersCreated: 0,
        uniqueVisitors: new Set()
      });
    }

    const page = pageStats.get(pageKey);

    if (event.visitorId) {
      page.uniqueVisitors.add(event.visitorId);
    }

    if (event.type === "page_view") {
      page.pageViews += 1;
    }

    if (event.type === "product_view") {
      page.productViews += 1;
    }

    if (event.type === "add_to_cart") {
      page.addToCart += 1;
    }

    if (event.type === "checkout_started") {
      page.checkoutStarts += 1;
    }

    if (event.type === "order_created") {
      page.ordersCreated += 1;
    }
  });

  const pageBreakdown = Array.from(pageStats.values())
    .map((entry) => ({
      path: entry.path,
      pageViews: entry.pageViews,
      productViews: entry.productViews,
      addToCart: entry.addToCart,
      checkoutStarts: entry.checkoutStarts,
      ordersCreated: entry.ordersCreated,
      uniqueVisitors: entry.uniqueVisitors.size
    }))
    .sort((left, right) => right.pageViews - left.pageViews);

  const totalOrders = byType.order_created || 0;
  const totalCheckouts = byType.checkout_started || 0;
  const totalPageViews = byType.page_view || 0;

  return {
    periodDays: requestedDays,
    since: since.toISOString(),
    totals: {
      events: events.length,
      uniqueVisitors: uniqueVisitors.size,
      pageViews: totalPageViews,
      productViews: byType.product_view || 0,
      addToCart: byType.add_to_cart || 0,
      checkoutStarts: totalCheckouts,
      ordersCreated: totalOrders,
      paymentsMarkedPaid: byType.payment_marked_paid || 0,
      referralClicks: byType.referral_click || 0
    },
    funnel: {
      visitorsToOrdersRate: uniqueVisitors.size ? Number(((totalOrders / uniqueVisitors.size) * 100).toFixed(2)) : 0,
      checkoutToOrderRate: totalCheckouts ? Number(((totalOrders / totalCheckouts) * 100).toFixed(2)) : 0,
      pageViewToOrderRate: totalPageViews ? Number(((totalOrders / totalPageViews) * 100).toFixed(2)) : 0
    },
    byPage: pageBreakdown
  };
}

function normalizeRewardClaims(rawClaims) {
  const claims = Array.isArray(rawClaims) ? rawClaims : [];
  const seen = new Set();

  return claims.reduce((result, claim) => {
    const referralCode = sanitizeReferralCode(claim && claim.referralCode);
    const rewardId = sanitizeText(claim && claim.rewardId, 80);
    const ownerToken = sanitizeOwnerToken(claim && claim.ownerToken);

    if (!referralCode || !rewardId || !ownerToken) {
      return result;
    }

    const key = `${referralCode}::${rewardId}`;
    if (seen.has(key)) {
      return result;
    }

    seen.add(key);
    result.push({ referralCode, rewardId, ownerToken });
    return result;
  }, []);
}

function claimReferralRewards(rewardClaims, orderId) {
  const claims = normalizeRewardClaims(rewardClaims);

  if (!claims.length) {
    return [];
  }

  const referrals = readReferrals();
  const claimedRewards = [];
  let hasChanges = false;

  claims.forEach((claim) => {
    const referral = referrals.find((entry) => entry.code === claim.referralCode);

    if (!referral) {
      return;
    }

    normalizeReferralEntry(referral);

    if (!referral.ownerToken || referral.ownerToken !== claim.ownerToken) {
      return;
    }

    const reward = referral.rewards.find((entry) => entry.id === claim.rewardId);

    if (!reward || reward.status === "claimed") {
      return;
    }

    reward.status = "claimed";
    reward.claimedAt = new Date().toISOString();
    reward.claimedOrderId = orderId;
    claimedRewards.push({
      ...reward,
      referralCode: referral.code
    });
    hasChanges = true;
  });

  if (hasChanges) {
    writeReferrals(referrals);
  }

  return claimedRewards;
}

function buildOrderEmail(order) {
  const breakdown = order.summary.priceBreakdown || {};
  const itemLinesText = order.items
    .map((item) => `- ${item.name} (${item.variantLabel}) x ${item.quantity}: ${formatAmount(item.subtotalAmount)}`)
    .join("\n");
  const itemRowsHtml = order.items
    .map((item) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eadfce;">${escapeEmailHtml(item.name)}<br><small>${escapeEmailHtml(item.variantLabel)}</small></td>
        <td style="padding:10px;border-bottom:1px solid #eadfce;text-align:center;">${item.quantity}</td>
        <td style="padding:10px;border-bottom:1px solid #eadfce;text-align:right;">${formatAmount(item.subtotalAmount)}</td>
      </tr>
    `)
    .join("");

  return {
    subject: `Order confirmed - ${order.id}`,
    text: [
      "Order confirmed",
      "",
      `Order reference: ${order.id}`,
      `PayNow UEN: ${order.businessUen}`,
      `Items subtotal: ${formatAmount(breakdown.subtotalBeforeAdjustments || order.summary.totalAmount)}`,
      breakdown.deliveryFee ? `Delivery fee: ${formatAmount(breakdown.deliveryFee)}` : "Delivery fee: Free",
      breakdown.deliveryDiscount ? `10% delivery discount: -${formatAmount(breakdown.deliveryDiscount)}` : null,
      breakdown.freeBoxDiscount ? `Free box reward: -${formatAmount(breakdown.freeBoxDiscount)}` : null,
      breakdown.referralCashDiscount ? `Referral cash reward: -${formatAmount(breakdown.referralCashDiscount)}` : null,
      breakdown.referralFreeBoxCount ? `Referral free box rewards: ${breakdown.referralFreeBoxCount}` : null,
      `Total: ${order.summary.totalDisplay}`,
      "",
      "Items:",
      itemLinesText,
      "",
      `Delivery address: ${order.customer.address}`,
      `Contact number: ${order.customer.phone}`,
      "",
      "Please complete payment using the PayNow UEN and order reference above."
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#211a13;background:#f7f1e7;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fffaf4;border-radius:18px;padding:24px;border:1px solid #eadfce;">
          <h1 style="margin:0 0 12px;font-size:28px;">Order confirmed</h1>
          <p style="margin:0 0 18px;">Thank you for ordering from Durian Paradise. Please complete payment using the PayNow details below.</p>
          <p><strong>Order reference:</strong> ${escapeEmailHtml(order.id)}</p>
          <p><strong>PayNow UEN:</strong> ${escapeEmailHtml(order.businessUen)}</p>
          <p><strong>Items subtotal:</strong> ${escapeEmailHtml(formatAmount(breakdown.subtotalBeforeAdjustments || order.summary.totalAmount))}</p>
          <p><strong>Delivery fee:</strong> ${escapeEmailHtml(breakdown.deliveryFee ? formatAmount(breakdown.deliveryFee) : "Free")}</p>
          ${breakdown.deliveryDiscount ? `<p><strong>10% delivery discount:</strong> -${escapeEmailHtml(formatAmount(breakdown.deliveryDiscount))}</p>` : ""}
          ${breakdown.freeBoxDiscount ? `<p><strong>Free box reward:</strong> -${escapeEmailHtml(formatAmount(breakdown.freeBoxDiscount))}</p>` : ""}
          ${breakdown.referralCashDiscount ? `<p><strong>Referral cash reward:</strong> -${escapeEmailHtml(formatAmount(breakdown.referralCashDiscount))}</p>` : ""}
          ${breakdown.referralFreeBoxCount ? `<p><strong>Referral free box rewards:</strong> ${escapeEmailHtml(String(breakdown.referralFreeBoxCount))}</p>` : ""}
          <p><strong>Total:</strong> ${escapeEmailHtml(order.summary.totalDisplay)}</p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0;">
            <thead>
              <tr>
                <th style="padding:10px;border-bottom:2px solid #d8c8b1;text-align:left;">Item</th>
                <th style="padding:10px;border-bottom:2px solid #d8c8b1;text-align:center;">Qty</th>
                <th style="padding:10px;border-bottom:2px solid #d8c8b1;text-align:right;">Subtotal</th>
              </tr>
            </thead>
            <tbody>${itemRowsHtml}</tbody>
          </table>
          <p><strong>Delivery address:</strong><br>${escapeEmailHtml(order.customer.address)}</p>
          <p><strong>Contact number:</strong> ${escapeEmailHtml(order.customer.phone)}</p>
        </div>
      </div>
    `
  };
}

function buildPaidNotificationEmail(order) {
  const orderEmail = buildOrderEmail(order);

  return {
    subject: `Customer marked paid - ${order.id}`,
    text: [
      "Customer marked this order as paid.",
      "",
      `Order reference: ${order.id}`,
      `PayNow UEN: ${order.businessUen}`,
      `Total: ${order.summary.totalDisplay}`,
      `Customer: ${order.customer.name || "Not provided"}`,
      `Email: ${order.customer.email}`,
      `Contact number: ${order.customer.phone}`,
      `Delivery address: ${order.customer.address}`,
      "",
      "Please verify this payment in the business bank account using the amount and order reference.",
      "",
      orderEmail.text
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;color:#211a13;background:#f7f1e7;padding:24px;">
        <div style="max-width:680px;margin:0 auto;background:#fffaf4;border-radius:18px;padding:24px;border:1px solid #eadfce;">
          <h1 style="margin:0 0 12px;font-size:28px;">Customer marked order as paid</h1>
          <p style="margin:0 0 18px;">Please verify this payment in the business bank account using the amount and order reference.</p>
          <p><strong>Order reference:</strong> ${escapeEmailHtml(order.id)}</p>
          <p><strong>Total:</strong> ${escapeEmailHtml(order.summary.totalDisplay)}</p>
          <p><strong>PayNow UEN:</strong> ${escapeEmailHtml(order.businessUen)}</p>
          <p><strong>Customer:</strong> ${escapeEmailHtml(order.customer.name || "Not provided")}</p>
          <p><strong>Email:</strong> ${escapeEmailHtml(order.customer.email)}</p>
          <p><strong>Contact:</strong> ${escapeEmailHtml(order.customer.phone)}</p>
          <p><strong>Address:</strong><br>${escapeEmailHtml(order.customer.address)}</p>
          ${orderEmail.html}
        </div>
      </div>
    `
  };
}

function escapeEmailHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendEmail({ to, subject, text, html }) {
  if (!resendApiKey) {
    return {
      status: "skipped",
      reason: "RESEND_API_KEY is not configured."
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: orderEmailFrom,
      to: Array.isArray(to) ? to : [to],
      reply_to: orderEmailReplyTo,
      subject,
      text,
      html
    })
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      status: "failed",
      reason: result.message || "Email provider rejected the request."
    };
  }

  return {
    status: "sent",
    provider: "resend",
    providerId: result.id || "",
    sentAt: new Date().toISOString()
  };
}

async function sendOrderConfirmationEmail(order) {
  const email = buildOrderEmail(order);
  return sendEmail({
    to: order.customer.email,
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

async function sendPaidNotificationEmail(order) {
  const email = buildPaidNotificationEmail(order);
  return sendEmail({
    to: orderNotificationEmail,
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

function buildPendingQrResponse(order) {
  return {
    provider: paymentProvider,
    providerName: paymentProviderName,
    exactAmountReady: true,
    requiresProviderIntegration: true,
    message: "Open your Singapore banking app, choose PayNow UEN, enter this exact amount, and use the order reference below. Automatic bank confirmation still requires a connected bank or SGQR provider API.",
    paynowToUen: businessUen,
    amountDisplay: order.summary.totalDisplay,
    reference: order.id
  };
}

app.post("/api/analytics/events", (req, res) => {
  const event = recordAnalyticsEvent({
    type: req.body && req.body.type,
    visitorId: req.body && req.body.visitorId,
    path: req.body && req.body.path,
    pageCategory: req.body && req.body.pageCategory,
    referrer: req.body && req.body.referrer,
    orderId: req.body && req.body.orderId,
    referralCode: req.body && req.body.referralCode,
    metadata: req.body && req.body.metadata,
    userAgent: req.get("user-agent")
  });

  if (!event) {
    return res.status(400).json({ error: "Unsupported analytics event type." });
  }

  return res.status(201).json({ ok: true });
});

app.get("/api/analytics/summary", requireAnalyticsAuth, (req, res) => {
  return res.json(buildAnalyticsSummary(req.query && req.query.days));
});

app.get("/api/reviews", (_req, res) => {
  const reviews = readReviews()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 24);

  res.json({ reviews });
});

app.post("/api/reviews", (req, res) => {
  const name = String(req.body && req.body.name ? req.body.name : "").trim();
  const comment = String(req.body && req.body.comment ? req.body.comment : "").trim();
  const rating = Number(req.body && req.body.rating);
  let image = "";

  if (!name || name.length < 2) {
    return res.status(400).json({ error: "Please enter your name." });
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Please choose a star rating from 1 to 5." });
  }

  if (!comment || comment.length < 10) {
    return res.status(400).json({ error: "Please add a short review of at least 10 characters." });
  }

  try {
    image = normalizeReviewImage(req.body && req.body.image);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const review = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.slice(0, 60),
    rating,
    comment: comment.slice(0, 600),
    image,
    createdAt: new Date().toISOString()
  };

  const reviews = readReviews();
  reviews.unshift(review);
  writeReviews(reviews.slice(0, 100));

  return res.status(201).json({ review });
});

app.post("/api/referrals", (req, res) => {
  const referrals = readReferrals();
  let code = makeReferralCode();

  while (referrals.some((entry) => entry.code === code)) {
    code = makeReferralCode();
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + (30 * 24 * 60 * 60 * 1000));
  const referral = {
    code,
    link: `${siteUrl.replace(/\/$/, "")}/referral.html?code=${code}`,
    ownerToken: makeOwnerToken(),
    referrer: null,
    clicks: 0,
    visitors: [],
    conversions: [],
    rewards: [],
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  referrals.unshift(referral);
  writeReferrals(referrals.slice(0, 1000));

  return res.status(201).json({
    referral: {
      code: referral.code,
      link: referral.link,
      expiresAt: referral.expiresAt,
      ownerToken: referral.ownerToken
    }
  });
});

app.get("/api/referrals/:code", (req, res) => {
  const code = sanitizeReferralCode(req.params.code);
  const referral = readReferrals().find((entry) => entry.code === code);

  if (!referral) {
    return res.status(404).json({ error: "Referral not found." });
  }

  normalizeReferralEntry(referral);

  return res.json({
    referral: {
      code: referral.code,
      link: referral.link,
      clicks: referral.clicks || 0,
      conversionCount: Array.isArray(referral.conversions) ? referral.conversions.length : 0,
      expiresAt: referral.expiresAt,
      isActive: new Date(referral.expiresAt).getTime() >= Date.now()
    }
  });
});

app.get("/api/referrals/:code/owner-status", (req, res) => {
  const code = sanitizeReferralCode(req.params.code);
  const ownerToken = sanitizeOwnerToken(req.query && req.query.ownerToken);
  const referrals = readReferrals();
  const referral = referrals.find((entry) => entry.code === code);

  if (!referral) {
    return res.status(404).json({ error: "Referral not found." });
  }

  normalizeReferralEntry(referral);

  if (!ownerToken || referral.ownerToken !== ownerToken) {
    return res.status(403).json({ error: "Referral owner token is invalid." });
  }

  writeReferrals(referrals);

  return res.json({
    referral: {
      code: referral.code,
      link: referral.link,
      expiresAt: referral.expiresAt,
      isActive: new Date(referral.expiresAt).getTime() >= Date.now(),
      conversionCount: referral.conversions.length,
      rewards: referral.rewards
    }
  });
});

app.get("/r/:code", (req, res) => {
  const code = sanitizeReferralCode(req.params.code);
  const referrals = readReferrals();
  const referral = referrals.find((entry) => entry.code === code);

  if (!referral) {
    return res.redirect("/referral.html?invalid=1");
  }

  if (new Date(referral.expiresAt).getTime() < Date.now()) {
    return res.redirect(`/referral.html?code=${code}&expired=1`);
  }

  if (referral) {
    normalizeReferralEntry(referral);
    referral.clicks = (referral.clicks || 0) + 1;
    referral.lastClickedAt = new Date().toISOString();
    referral.visitors = Array.isArray(referral.visitors) ? referral.visitors : [];
    referral.visitors.push({
      visitedAt: referral.lastClickedAt,
      userAgent: String(req.get("user-agent") || "").slice(0, 180)
    });
    referral.visitors = referral.visitors.slice(-200);
    writeReferrals(referrals);
    recordAnalyticsEvent({
      type: "referral_click",
      path: `/r/${code}`,
      referralCode: code,
      userAgent: req.get("user-agent")
    });
  }

  return res.redirect(`/?ref=${code}`);
});

app.get("/api/payment-config", (_req, res) => {
  return res.json({
    businessUen,
    provider: paymentProvider,
    providerName: paymentProviderName,
    dynamicQrReady: false
  });
});

app.get("/api/payment-orders/:orderId", (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  const order = readOrders().find((entry) => entry.id === orderId);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  return res.json({ order });
});

app.post("/api/payment-orders/:orderId/paid", async (req, res) => {
  const orderId = String(req.params.orderId || "").trim();
  const orders = readOrders();
  const order = orders.find((entry) => entry.id === orderId);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  order.status = "customer_marked_paid";
  order.customerPaymentAcknowledgement = {
    status: "customer_marked_paid",
    message: "Customer clicked I Have Paid. Business still needs to verify the bank transfer.",
    acknowledgedAt: new Date().toISOString()
  };

  try {
    order.businessPaymentNotification = await sendPaidNotificationEmail(order);
  } catch (error) {
    order.businessPaymentNotification = {
      status: "failed",
      reason: error && error.message ? error.message : "Unable to send business notification email."
    };
  }

  writeOrders(orders.slice(0, 500));
  recordAnalyticsEvent({
    type: "payment_marked_paid",
    orderId,
    path: "/api/payment-orders/:orderId/paid",
    userAgent: req.get("user-agent")
  });

  return res.json({
    order,
    paymentRequest: order.paymentRequest
  });
});

app.post("/api/payment-orders", async (req, res) => {
  try {
    const items = normalizeCartItems(req.body && req.body.items);
    const orders = readOrders();
    const orderId = makeOrderId(orders);
    const customer = req.body && req.body.customer ? req.body.customer : {};
    const customerPhone = String(customer.phone || "").trim();
    const customerEmail = String(customer.email || "").trim();
    const customerAddress = String(customer.address || "").trim();
    const referralCode = sanitizeReferralCode(req.body && req.body.referralCode);
    const baseSummary = summarizeOrder(items);
    let referralResult = null;

    if (!customerPhone) {
      throw new Error("Please enter your contact number.");
    }

    if (!isValidEmail(customerEmail)) {
      throw new Error("Please enter a valid email address.");
    }

    if (!customerAddress) {
      throw new Error("Please enter your delivery address.");
    }

    if (!baseSummary.priceBreakdown.minimumDeliveryBoxesMet) {
      throw new Error("Online Delivery requires a minimum of 3 boxes.");
    }

    const claimedReferralRewards = claimReferralRewards(req.body && req.body.referralRewardClaims, orderId);
    const summary = summarizeOrder(items, claimedReferralRewards);

    if (referralCode) {
      const referrals = readReferrals();
      const referral = referrals.find((entry) => entry.code === referralCode);

      if (referral && new Date(referral.expiresAt).getTime() >= Date.now()) {
        normalizeReferralEntry(referral);
        const conversions = Array.isArray(referral.conversions) ? referral.conversions : [];
        const nextCount = conversions.length + 1;
        const reward = getReferralReward(nextCount);
        const conversion = {
          orderId,
          orderTotal: summary.totalDisplay,
          customerPhone: customerPhone.slice(0, 40),
          createdAt: new Date().toISOString()
        };

        conversions.push(conversion);
        referral.conversions = conversions;
        referral.lastConvertedAt = conversion.createdAt;

        if (reward) {
          const issuedReward = {
            id: makeRecordId("reward"),
            type: reward.type,
            label: reward.label,
            discountAmount: reward.discountAmount,
            message: reward.message,
            referralCount: nextCount,
            referralCycle: Math.floor((nextCount - 1) / 3) + 1,
            orderId,
            status: "issued_for_next_purchase",
            createdAt: conversion.createdAt,
            claimedAt: "",
            claimedOrderId: ""
          };
          referral.rewards = Array.isArray(referral.rewards) ? referral.rewards : [];
          referral.rewards.push(issuedReward);
          referralResult = issuedReward;
        }

        writeReferrals(referrals);
      }
    }

    const order = {
      id: orderId,
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentStatus: "awaiting_provider_setup",
      paymentMethod: paymentProviderName,
      businessUen,
      items,
      summary,
      customer: {
        name: String(customer.name || "").trim().slice(0, 80),
        phone: customerPhone.slice(0, 40),
        email: customerEmail.slice(0, 120),
        address: customerAddress.slice(0, 260),
        deliveryNotes: String(customer.deliveryNotes || "").trim().slice(0, 220)
      },
      referral: referralResult ? {
        code: referralCode,
        reward: referralResult
      } : null,
      claimedReferralRewards,
      paymentRequest: buildPendingQrResponse({ summary, id: orderId }),
      emailConfirmation: {
        status: "pending"
      }
    };

    try {
      order.emailConfirmation = await sendOrderConfirmationEmail(order);
    } catch (error) {
      order.emailConfirmation = {
        status: "failed",
        reason: error && error.message ? error.message : "Unable to send confirmation email."
      };
    }

    orders.unshift(order);
    writeOrders(orders.slice(0, 500));
    recordAnalyticsEvent({
      type: "order_created",
      orderId,
      visitorId: req.body && req.body.visitorId,
      path: sanitizeAnalyticsPath(req.body && req.body.path),
      pageCategory: req.body && req.body.pageCategory,
      referralCode,
      metadata: {
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0)
      },
      userAgent: req.get("user-agent")
    });

    return res.status(201).json({
      order,
      paymentRequest: order.paymentRequest
    });
  } catch (error) {
    return res.status(400).json({
      error: error && error.message ? error.message : "Unable to create payment order."
    });
  }
});

app.post("/api/create-checkout-session", async (req, res) => {
  if (!stripeSecretKey) {
    return res.status(500).json({ error: "Stripe secret key is not configured." });
  }

  const stripe = new Stripe(stripeSecretKey);
  let normalizedItems;

  try {
    normalizedItems = normalizeCartItems(req.body && req.body.items);
  } catch (error) {
    return res.status(400).json({ error: error && error.message ? error.message : "Unable to read cart items." });
  }

  const lineItems = normalizedItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "sgd",
        unit_amount: item.unitAmount,
        product_data: {
          name: item.name,
          description: `${item.orderType} - ${item.variantLabel}`
        }
      }
    }));

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cancel.html`,
      billing_address_collection: "auto",
      phone_number_collection: {
        enabled: true
      },
      allow_promotion_codes: true
    });

    return res.json({ url: session.url });
  } catch (error) {
    return res.status(500).json({
      error: error && error.message ? error.message : "Unable to create Stripe checkout session."
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`Durian Paradise server running on ${siteUrl}`);
});
