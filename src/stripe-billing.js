"use strict";

/**
 * Kandi+ website billing via Stripe Checkout (subscription mode).
 * Disabled until STRIPE_SECRET_KEY and STRIPE_PRICE_IDS are set.
 * Never expose Stripe or any outside-payment link inside the iOS Capacitor app.
 * Never log secrets or raw key material.
 */

const crypto = require("crypto");

const ACTIVE_STATUSES = new Set(["active", "trialing"]);
const KEEP_STATUSES = new Set(["active", "trialing", "past_due", "paused"]);
const DEFAULT_INTERVALS = ["monthly", "yearly"];

function parsePriceIds(raw) {
  if (!raw) return {};
  const text = String(raw).trim();
  if (!text) return {};
  let obj = null;
  if (text.startsWith("{")) {
    try { obj = JSON.parse(text); } catch (_) { obj = null; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    obj = {};
    for (const part of text.split(/[,;\n]+/)) {
      const bit = part.trim();
      if (!bit) continue;
      const i = bit.indexOf(":");
      if (i <= 0) continue;
      obj[bit.slice(0, i).trim()] = bit.slice(i + 1).trim();
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k || "").trim();
    const val = String(v || "").trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function getConfig(env = process.env) {
  const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  const prices = parsePriceIds(env.STRIPE_PRICE_IDS);
  const publicUrl = String(env.KANDI_PUBLIC_URL || env.STRIPE_APP_URL || "").trim().replace(/\/$/, "");
  const hasPrices = Object.keys(prices).length > 0;
  return {
    secretKey,
    webhookSecret,
    prices,
    publicUrl,
    enabled: Boolean(secretKey && hasPrices),
  };
}

function planKey(plan, interval) {
  const p = plan === "vip" ? "vip" : "plus";
  const i = interval === "yearly" || interval === "year" ? "yearly" : "monthly";
  return `${p}_${i}`;
}

function planFromPriceId(priceId, prices) {
  if (!priceId || !prices) return null;
  for (const [key, id] of Object.entries(prices)) {
    if (id === priceId) {
      if (key.startsWith("vip")) return "vip";
      if (key.startsWith("plus")) return "plus";
    }
  }
  return null;
}

function intervalFromPriceKey(key) {
  if (String(key).includes("yearly") || String(key).includes("year")) return "yearly";
  return "monthly";
}

function entitlementForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (KEEP_STATUSES.has(s)) return true;
  return false;
}

function formatMoney(unitAmount, currency) {
  if (unitAmount == null || Number.isNaN(Number(unitAmount))) return null;
  const amount = Number(unitAmount) / 100;
  const cur = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(amount);
  } catch (_) {
    return (cur === "USD" ? "$" : cur + " ") + amount.toFixed(2);
  }
}

function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!secret) {
    const err = new Error("Webhook secret is not configured.");
    err.code = "webhook_disabled";
    throw err;
  }
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || "", "utf8");
  const parts = String(header || "").split(",").map((p) => p.trim());
  let timestamp = "";
  const signatures = [];
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === "t") timestamp = v;
    if (k === "v1") signatures.push(v);
  }
  if (!timestamp || !signatures.length) {
    const err = new Error("Invalid Stripe-Signature header.");
    err.code = "bad_signature";
    throw err;
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(Number(timestamp)) || age > toleranceSec) {
    const err = new Error("Stripe webhook timestamp is outside the allowed tolerance.");
    err.code = "bad_signature";
    throw err;
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const ok = signatures.some((sig) => {
    const got = Buffer.from(String(sig), "utf8");
    return got.length === expectedBuf.length && crypto.timingSafeEqual(got, expectedBuf);
  });
  if (!ok) {
    const err = new Error("Stripe webhook signature mismatch.");
    err.code = "bad_signature";
    throw err;
  }
  return true;
}

function publicPlans(config, { ios = false, priceDetails = {} } = {}) {
  if (ios) {
    return {
      paymentsEnabled: false,
      store: "iap_coming_soon",
      intervals: DEFAULT_INTERVALS,
      plans: {
        plus: {
          features: ["Unlimited likes", "See who likes you", "Advanced filters", "5 rewinds / day"],
        },
      },
      note: "Kandi+ is coming soon and will be sold through Apple In-App Purchase.",
    };
  }
  if (!config.enabled) {
    return {
      paymentsEnabled: false,
      store: "disabled",
      intervals: DEFAULT_INTERVALS,
      plans: {
        plus: {
          features: ["Unlimited likes", "See who likes you", "Advanced filters", "5 rewinds / day"],
        },
      },
      note: "Kandi+ payments are not available yet.",
    };
  }
  const plans = {};
  for (const plan of ["plus", "vip"]) {
    const intervals = {};
    let any = false;
    for (const interval of DEFAULT_INTERVALS) {
      const key = planKey(plan, interval);
      const priceId = config.prices[key];
      if (!priceId) continue;
      any = true;
      const detail = priceDetails[key] || priceDetails[priceId] || {};
      intervals[interval] = {
        key,
        label: detail.label || null,
        amount: detail.amount != null ? detail.amount : null,
        currency: detail.currency || "usd",
      };
    }
    if (any) {
      plans[plan] = {
        intervals,
        features: plan === "vip"
          ? ["Everything in Kandi+", "Unlimited rewinds", "Priority at events and live mode"]
          : ["Unlimited likes", "See who likes you", "Advanced filters", "5 rewinds / day"],
      };
    }
  }
  if (!plans.plus) {
    plans.plus = {
      features: ["Unlimited likes", "See who likes you", "Advanced filters", "5 rewinds / day"],
      intervals: {},
    };
  }
  return {
    paymentsEnabled: true,
    store: "stripe",
    intervals: DEFAULT_INTERVALS.filter((interval) =>
      Object.values(plans).some((p) => p.intervals && p.intervals[interval])
    ),
    plans,
    note: "Checkout is handled securely by Stripe. Cancel anytime from Manage membership.",
  };
}

function publicBillingForUser(user, config, { ios = false } = {}) {
  const hasCustomer = Boolean(user && user.stripe_customer_id);
  return {
    paymentsEnabled: Boolean(config.enabled) && !ios,
    managed: Boolean(config.enabled) && hasCustomer && !ios,
    status: user && user.subscription_status ? String(user.subscription_status) : null,
  };
}

function requestOrigin(req, config) {
  if (config.publicUrl) return config.publicUrl;
  const proto = String((req.get && req.get("x-forwarded-proto")) || req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String((req.get && req.get("x-forwarded-host")) || (req.get && req.get("host")) || req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

async function findUserForStripe(db, { userId, customerId, subscriptionId }) {
  if (userId) {
    const row = await db.prepare(`SELECT * FROM users WHERE id=?`).get(Number(userId));
    if (row) return row;
  }
  if (subscriptionId) {
    const row = await db.prepare(`SELECT * FROM users WHERE stripe_subscription_id=?`).get(String(subscriptionId));
    if (row) return row;
  }
  if (customerId) {
    const row = await db.prepare(`SELECT * FROM users WHERE stripe_customer_id=?`).get(String(customerId));
    if (row) return row;
  }
  return null;
}

async function writeBilling(db, userId, fields) {
  const cols = [];
  const vals = [];
  const map = {
    subscription: "subscription",
    stripe_customer_id: "stripe_customer_id",
    stripe_subscription_id: "stripe_subscription_id",
    stripe_price_id: "stripe_price_id",
    subscription_status: "subscription_status",
  };
  for (const [key, col] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      cols.push(`${col}=?`);
      vals.push(fields[key]);
    }
  }
  if (!cols.length) return;
  vals.push(userId);
  await db.prepare(`UPDATE users SET ${cols.join(", ")} WHERE id=?`).run(...vals);
}

function metadataUserId(...objs) {
  for (const obj of objs) {
    if (!obj) continue;
    const raw = (obj.metadata && (obj.metadata.userId || obj.metadata.user_id)) || obj.client_reference_id;
    if (raw != null && String(raw).trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function itemPriceId(sub) {
  const item = sub && sub.items && Array.isArray(sub.items.data) ? sub.items.data[0] : null;
  const price = item && item.price;
  if (!price) return (sub && sub.plan && sub.plan.id) || null;
  return typeof price === "string" ? price : price.id;
}

function applySubscriptionFields(user, sub, config, extra = {}) {
  const status = String((sub && sub.status) || extra.status || "").toLowerCase() || null;
  const priceId = itemPriceId(sub) || extra.priceId || null;
  const keep = entitlementForStatus(status);
  const plan = (extra.plan && (extra.plan === "vip" ? "vip" : "plus"))
    || planFromPriceId(priceId, config.prices)
    || (keep ? "plus" : null);
  const fields = {
    stripe_customer_id: (sub && (sub.customer && (typeof sub.customer === "string" ? sub.customer : sub.customer.id)))
      || extra.customerId
      || (user && user.stripe_customer_id)
      || null,
    stripe_subscription_id: (sub && sub.id) || extra.subscriptionId || (user && user.stripe_subscription_id) || null,
    stripe_price_id: priceId || (user && user.stripe_price_id) || null,
    subscription_status: status,
    subscription: keep ? (plan || "plus") : null,
  };
  return fields;
}

async function applyCheckoutSession(db, session, config) {
  if (!session || session.mode && session.mode !== "subscription") return { ok: false, reason: "not_subscription" };
  const customerId = typeof session.customer === "string" ? session.customer : session.customer && session.customer.id;
  const subscriptionId = typeof session.subscription === "string"
    ? session.subscription
    : session.subscription && session.subscription.id;
  const userId = metadataUserId(session);
  const user = await findUserForStripe(db, { userId, customerId, subscriptionId });
  if (!user) return { ok: false, reason: "user_not_found" };
  const paid = !session.payment_status || session.payment_status === "paid" || session.payment_status === "no_payment_required";
  const plan = (session.metadata && session.metadata.plan) || "plus";
  const priceId = session.metadata && session.metadata.priceKey
    ? config.prices[session.metadata.priceKey]
    : null;
  const status = paid ? "active" : "incomplete";
  const fields = applySubscriptionFields(user, typeof session.subscription === "object" ? session.subscription : null, config, {
    customerId,
    subscriptionId,
    plan: plan === "vip" ? "vip" : "plus",
    priceId,
    status,
  });
  if (!paid) fields.subscription = user.subscription || null;
  await writeBilling(db, user.id, fields);
  return { ok: true, userId: user.id, granted: Boolean(fields.subscription) };
}

async function applySubscriptionEvent(db, sub, config) {
  if (!sub || !sub.id) return { ok: false, reason: "no_subscription" };
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id;
  const userId = metadataUserId(sub);
  const user = await findUserForStripe(db, { userId, customerId, subscriptionId: sub.id });
  if (!user) return { ok: false, reason: "user_not_found" };
  const fields = applySubscriptionFields(user, sub, config, { customerId });
  await writeBilling(db, user.id, fields);
  return { ok: true, userId: user.id, granted: Boolean(fields.subscription), status: fields.subscription_status };
}

async function applyInvoicePaymentFailed(db, invoice, config) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer && invoice.customer.id;
  const subscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : invoice.subscription && invoice.subscription.id;
  const user = await findUserForStripe(db, { customerId, subscriptionId });
  if (!user) return { ok: false, reason: "user_not_found" };
  // Keep access while Stripe retries; mark past_due so the portal can collect a new card.
  const keep = user.subscription || "plus";
  await writeBilling(db, user.id, {
    stripe_customer_id: customerId || user.stripe_customer_id,
    stripe_subscription_id: subscriptionId || user.stripe_subscription_id,
    subscription_status: "past_due",
    subscription: keep,
  });
  return { ok: true, userId: user.id, granted: true, status: "past_due" };
}

async function handleStripeEvent(db, event, config) {
  const type = event && event.type;
  const obj = event && event.data && event.data.object;
  if (!type || !obj) return { ok: false, reason: "invalid_event" };
  if (type === "checkout.session.completed") return applyCheckoutSession(db, obj, config);
  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    return applySubscriptionEvent(db, obj, config);
  }
  if (type === "invoice.payment_failed") return applyInvoicePaymentFailed(db, obj, config);
  return { ok: true, ignored: true, type };
}

function parseEventPayload(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  return JSON.parse(text);
}

let stripeClient = null;
let stripeKeyUsed = "";
let stripeFactory = null;

function setStripeFactory(fn) {
  stripeFactory = fn;
  stripeClient = null;
  stripeKeyUsed = "";
}

function getStripe(config) {
  if (!config.secretKey) return null;
  if (stripeClient && stripeKeyUsed === config.secretKey) return stripeClient;
  if (stripeFactory) {
    stripeClient = stripeFactory(config.secretKey);
  } else {
    const Stripe = require("stripe");
    stripeClient = new Stripe(config.secretKey, { timeout: 20000 });
  }
  stripeKeyUsed = config.secretKey;
  return stripeClient;
}

const priceCache = { at: 0, details: {} };

async function loadPriceDetails(config) {
  if (!config.enabled) return {};
  if (priceCache.at && Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.details;
  const stripe = getStripe(config);
  if (!stripe || !stripe.prices || !stripe.prices.retrieve) return {};
  const details = {};
  for (const [key, id] of Object.entries(config.prices)) {
    try {
      const price = await stripe.prices.retrieve(id);
      details[key] = {
        amount: price.unit_amount,
        currency: price.currency,
        label: formatMoney(price.unit_amount, price.currency),
      };
    } catch (err) {
      console.error("Stripe price lookup failed for", key, err && err.message);
    }
  }
  priceCache.at = Date.now();
  priceCache.details = details;
  return details;
}

function resetPriceCache() {
  priceCache.at = 0;
  priceCache.details = {};
}

async function cancelStripeForUser(user, config) {
  if (!user || !user.stripe_subscription_id || !config.enabled) return { skipped: true };
  const stripe = getStripe(config);
  if (!stripe) return { skipped: true };
  try {
    await stripe.subscriptions.cancel(user.stripe_subscription_id);
    return { ok: true };
  } catch (err) {
    console.error("Stripe cancel on account delete failed:", err && err.message);
    return { ok: false };
  }
}

function createWebhookHandler(getDb) {
  return async function webhookHandler(req, res) {
    const config = getConfig();
    if (!config.enabled || !config.webhookSecret) {
      return res.status(503).json({ error: "Billing is not configured.", code: "billing_disabled" });
    }
    const payload = req.body;
    try {
      verifyStripeSignature(payload, req.headers["stripe-signature"] || req.get && req.get("stripe-signature"), config.webhookSecret);
    } catch (err) {
      const status = err.code === "webhook_disabled" ? 503 : 400;
      return res.status(status).json({ error: "Invalid webhook signature.", code: err.code || "bad_signature" });
    }
    let event;
    try {
      event = parseEventPayload(payload);
    } catch (_) {
      return res.status(400).json({ error: "Invalid webhook payload.", code: "bad_payload" });
    }
    try {
      const result = await handleStripeEvent(getDb(), event, config);
      if (result && result.reason === "user_not_found") {
        console.error("Stripe webhook user not found for event", event.type, event.id || "");
      }
      return res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook handler failed:", err && err.message);
      return res.status(500).json({ error: "Webhook processing failed." });
    }
  };
}

function mountStripeWebhook(app, getDb) {
  app.post("/api/stripe/webhook", expressRawJson(), createWebhookHandler(getDb));
}

function expressRawJson() {
  const express = require("express");
  return express.raw({ type: "application/json" });
}

function installStripeBilling({ app, getDb, auth, isNativeIosClient, publicUser }) {
  app.get("/api/plans", async (req, res) => {
    const config = getConfig();
    const ios = isNativeIosClient(req);
    let priceDetails = {};
    if (config.enabled && !ios) {
      try { priceDetails = await loadPriceDetails(config); } catch (_) { priceDetails = {}; }
    }
    res.json(publicPlans(config, { ios, priceDetails }));
  });

  app.post("/api/billing/checkout", auth, async (req, res) => {
    if (isNativeIosClient(req)) {
      return res.status(403).json({
        error: "Kandi+ is coming soon and will be sold only through Apple In-App Purchase.",
        code: "plus_coming_soon",
      });
    }
    const config = getConfig();
    if (!config.enabled) {
      return res.status(503).json({ error: "Kandi+ payments are not available yet.", code: "billing_disabled" });
    }
    const plan = req.body && req.body.plan === "vip" ? "vip" : "plus";
    const interval = req.body && (req.body.interval === "yearly" || req.body.interval === "year") ? "yearly" : "monthly";
    const key = planKey(plan, interval);
    const priceId = config.prices[key];
    if (!priceId) {
      return res.status(400).json({ error: "That plan is not available yet.", code: "price_unavailable" });
    }
    const origin = requestOrigin(req, config);
    if (!origin) {
      return res.status(500).json({ error: "Could not build a checkout return URL." });
    }
    const stripe = getStripe(config);
    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?billing=cancel`,
      client_reference_id: String(req.user.id),
      metadata: { userId: String(req.user.id), plan, interval, priceKey: key },
      subscription_data: { metadata: { userId: String(req.user.id), plan, interval, priceKey: key } },
      allow_promotion_codes: true,
    };
    if (req.user.stripe_customer_id) sessionParams.customer = req.user.stripe_customer_id;
    try {
      const session = await stripe.checkout.sessions.create(sessionParams);
      if (!session || !session.url) {
        return res.status(502).json({ error: "Checkout could not be started. Try again in a moment." });
      }
      return res.json({ url: session.url, id: session.id });
    } catch (err) {
      console.error("Stripe checkout session failed:", err && err.message);
      return res.status(502).json({ error: "Checkout could not be started. Try again in a moment." });
    }
  });

  app.post("/api/billing/portal", auth, async (req, res) => {
    if (isNativeIosClient(req)) {
      return res.status(403).json({
        error: "Kandi+ is coming soon and will be sold only through Apple In-App Purchase.",
        code: "plus_coming_soon",
      });
    }
    const config = getConfig();
    if (!config.enabled) {
      return res.status(503).json({ error: "Kandi+ payments are not available yet.", code: "billing_disabled" });
    }
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: "There's no membership to manage yet.", code: "no_customer" });
    }
    const origin = requestOrigin(req, config);
    const stripe = getStripe(config);
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: req.user.stripe_customer_id,
        return_url: `${origin}/?billing=portal`,
      });
      if (!session || !session.url) {
        return res.status(502).json({ error: "Could not open the membership portal." });
      }
      return res.json({ url: session.url });
    } catch (err) {
      console.error("Stripe portal session failed:", err && err.message);
      return res.status(502).json({ error: "Could not open the membership portal." });
    }
  });

  app.post("/api/billing/sync", auth, async (req, res) => {
    const config = getConfig();
    const db = getDb();
    if (!isNativeIosClient(req) && config.enabled) {
      const sessionId = String((req.body && (req.body.sessionId || req.body.session_id)) || "").trim();
      if (sessionId) {
        try {
          const stripe = getStripe(config);
          const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
          const sessionUser = metadataUserId(session);
          if (sessionUser && Number(sessionUser) === Number(req.user.id)) {
            await applyCheckoutSession(db, session, config);
          }
        } catch (err) {
          console.error("Stripe billing sync failed:", err && err.message);
        }
      }
    }
    const user = await db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    res.json({
      user: publicUser(user, { billing: publicBillingForUser(user, config, { ios: isNativeIosClient(req) }) }),
    });
  });

  return { mountStripeWebhook, createWebhookHandler };
}

module.exports = {
  parsePriceIds,
  getConfig,
  planKey,
  planFromPriceId,
  entitlementForStatus,
  formatMoney,
  verifyStripeSignature,
  publicPlans,
  publicBillingForUser,
  requestOrigin,
  findUserForStripe,
  writeBilling,
  applyCheckoutSession,
  applySubscriptionEvent,
  applyInvoicePaymentFailed,
  handleStripeEvent,
  parseEventPayload,
  setStripeFactory,
  getStripe,
  loadPriceDetails,
  resetPriceCache,
  cancelStripeForUser,
  installStripeBilling,
  mountStripeWebhook,
  createWebhookHandler,
  expressRawJson,
  ACTIVE_STATUSES,
  KEEP_STATUSES,
};
