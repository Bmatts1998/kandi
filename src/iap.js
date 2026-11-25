"use strict";

/**
 * Apple / Google in-app purchase hooks, behind a flag.
 * IAP_ENABLED is off for Kandi 1.0 (in App Review). Do not wire this into
 * the iOS Capacitor binary or trigger a new TestFlight / App Store build.
 *
 * Product IDs (App Store subscription group "Kandi Plus"):
 *   com.marshandbarb.kandi.plus.monthly
 *   com.marshandbarb.kandi.plus.3mo
 *   com.marshandbarb.kandi.plus.6mo
 *   com.marshandbarb.kandi.plus.yearly
 *   com.marshandbarb.kandi.plus.founding
 *
 * When IAP ships, verify transactions with the App Store Server API
 * (signed JWS) and grant/revoke the same user.subscription fields used
 * by Stripe webhooks. Never send iOS clients to Stripe.
 */

const { PLANS, BUNDLE_ID, planByProductId } = require("./plus-plans");

function iapEnabled(env = process.env) {
  return String(env.IAP_ENABLED || "") === "1";
}

function productIds() {
  return Object.values(PLANS).map((p) => p.productId);
}

async function verifyAppleTransaction(/* signedTransaction */) {
  if (!iapEnabled()) {
    const err = new Error("In-app purchases are not enabled in this version.");
    err.code = "iap_disabled";
    throw err;
  }
  const err = new Error("App Store Server API verification is not connected yet.");
  err.code = "iap_not_connected";
  throw err;
}

function installIapRoutes({ app, auth, isNativeIosClient }) {
  app.post("/api/billing/iap/verify", auth, async (req, res) => {
    if (!iapEnabled()) {
      return res.status(503).json({
        error: "Kandi+ will be sold through the App Store when in-app purchases launch.",
        code: "iap_coming_soon",
      });
    }
    try {
      await verifyAppleTransaction(req.body && req.body.transaction);
      return res.status(501).json({ error: "IAP verification is not connected yet.", code: "iap_not_connected" });
    } catch (err) {
      return res.status(err.code === "iap_disabled" ? 503 : 501).json({
        error: err.message,
        code: err.code || "iap_error",
      });
    }
  });
  // isNativeIosClient is accepted so a later IAP path can branch without a new route shape.
  void isNativeIosClient;
}

module.exports = {
  BUNDLE_ID,
  iapEnabled,
  productIds,
  planByProductId,
  verifyAppleTransaction,
  installIapRoutes,
};
