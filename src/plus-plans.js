"use strict";

/**
 * Single source of truth for Kandi Plus prices and IAP product IDs.
 * Change amounts here (and the matching Stripe / App Store prices) in one place.
 * Yearly is $59.99, confirmed.
 */

const BUNDLE_ID = "com.marshandbarb.kandi";

const PLANS = {
  founding_monthly: {
    key: "founding_monthly",
    plan: "founding",
    interval: "monthly",
    intervalCount: 1,
    amount: 4.99,
    currency: "usd",
    label: "$4.99/mo",
    period: "per month",
    name: "Founding monthly",
    hint: "Founding member rate after your complimentary year",
    productId: `${BUNDLE_ID}.plus.founding`,
    stripeKey: "founding_monthly",
    foundersOnly: true,
  },
  plus_monthly: {
    key: "plus_monthly",
    plan: "plus",
    interval: "monthly",
    intervalCount: 1,
    amount: 7.99,
    currency: "usd",
    label: "$7.99/mo",
    period: "per month",
    name: "Monthly",
    hint: "Billed every month",
    productId: `${BUNDLE_ID}.plus.monthly`,
    stripeKey: "plus_monthly",
  },
  plus_3mo: {
    key: "plus_3mo",
    plan: "plus",
    interval: "3mo",
    intervalCount: 3,
    amount: 19.99,
    currency: "usd",
    label: "$19.99",
    period: "every 3 months",
    name: "3 months",
    hint: "Billed every 3 months",
    productId: `${BUNDLE_ID}.plus.3mo`,
    stripeKey: "plus_3mo",
  },
  plus_6mo: {
    key: "plus_6mo",
    plan: "plus",
    interval: "6mo",
    intervalCount: 6,
    amount: 34.99,
    currency: "usd",
    label: "$34.99",
    period: "every 6 months",
    name: "6 months",
    hint: "Billed every 6 months",
    productId: `${BUNDLE_ID}.plus.6mo`,
    stripeKey: "plus_6mo",
  },
  plus_yearly: {
    key: "plus_yearly",
    plan: "plus",
    interval: "yearly",
    intervalCount: 1,
    amount: 59.99,
    currency: "usd",
    label: "$59.99/year",
    period: "per year",
    name: "Yearly",
    hint: "Best value — billed once a year",
    productId: `${BUNDLE_ID}.plus.yearly`,
    stripeKey: "plus_yearly",
    confirmed: true,
  },
};

const FOUNDING_CAP = 3000;
const FOUNDING_FREE_MONTHS = 12;
const PLUS_FEATURES = [
  "Unlimited likes",
  "See who likes you",
  "Advanced filters",
  "5 rewinds / day",
];

function foundingCap(env = process.env) {
  const raw = Number(env.KANDI_FOUNDING_CAP);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return FOUNDING_CAP;
}

function planList() {
  return ["plus_monthly", "plus_3mo", "plus_6mo", "plus_yearly"].map((k) => ({ ...PLANS[k] }));
}

function publicCatalog({ ios = false, isFounder = false, stripePrices = {}, stripeEnabled = false } = {}) {
  if (ios) {
    return {
      features: [],
      plans: [],
      founding: { available: false },
      yearlyConfirmed: true,
      payments: { iapComingSoon: true, websiteReady: false },
    };
  }
  const plans = planList().map((p) => {
    const stripe = stripePrices[p.stripeKey] || {};
    return {
      key: p.key,
      interval: p.interval,
      name: p.name,
      amount: p.amount,
      currency: p.currency,
      label: stripe.label || p.label,
      period: p.period,
      hint: p.hint,
      productId: p.productId,
    };
  });
  const founding = { ...PLANS.founding_monthly };
  return {
    features: PLUS_FEATURES.slice(),
    plans,
    founding: {
      key: founding.key,
      interval: "monthly",
      name: founding.name,
      amount: founding.amount,
      currency: founding.currency,
      label: founding.label,
      period: founding.period,
      hint: founding.hint,
      productId: founding.productId,
      available: Boolean(isFounder),
    },
    yearlyConfirmed: true,
    payments: ios
      ? { iapComingSoon: true, websiteReady: false }
      : { websiteReady: Boolean(stripeEnabled), iapComingSoon: false },
  };
}

function resolvePlanKey(plan, interval) {
  const p = String(plan || "plus").toLowerCase();
  const i = String(interval || "monthly").toLowerCase();
  if (p === "founding" || i === "founding" || i === "founding_monthly") return "founding_monthly";
  if (i === "3mo" || i === "quarterly" || i === "3" || i === "three") return "plus_3mo";
  if (i === "6mo" || i === "six" || i === "6") return "plus_6mo";
  if (i === "yearly" || i === "year" || i === "annual") return p === "vip" ? "vip_yearly" : "plus_yearly";
  if (p === "vip") return "vip_monthly";
  return "plus_monthly";
}

function planByKey(key) {
  return PLANS[key] || null;
}

function planByProductId(productId) {
  return Object.values(PLANS).find((p) => p.productId === productId) || null;
}

function planByStripeKey(stripeKey, stripePriceIds) {
  if (stripePriceIds) {
    for (const [key, id] of Object.entries(stripePriceIds)) {
      if (id === stripeKey || key === stripeKey) return PLANS[key] || PLANS[stripeKey] || null;
    }
  }
  return PLANS[stripeKey] || null;
}

module.exports = {
  BUNDLE_ID,
  PLANS,
  FOUNDING_CAP,
  FOUNDING_FREE_MONTHS,
  PLUS_FEATURES,
  foundingCap,
  planList,
  publicCatalog,
  resolvePlanKey,
  planByKey,
  planByProductId,
  planByStripeKey,
};
