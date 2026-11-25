# Kandi Plus in-app purchases (not in 1.0)

Kandi 1.0 is in App Review. Do not add a store plugin, bump the iOS version, or run `ios-build.yml` for this work.

When IAP ships, use StoreKit / a purchase plugin such as `cordova-plugin-purchase` or RevenueCat, and verify transactions on the server with the App Store Server API. The hook lives in `src/iap.js` behind `IAP_ENABLED=1`.

Product IDs in subscription group **Kandi Plus**, bundle `com.marshandbarb.kandi`:

| Product ID | Plan | Price |
|---|---|---|
| `com.marshandbarb.kandi.plus.monthly` | Monthly | $7.99/mo |
| `com.marshandbarb.kandi.plus.3mo` | 3 months | $19.99 |
| `com.marshandbarb.kandi.plus.6mo` | 6 months | $34.99 |
| `com.marshandbarb.kandi.plus.yearly` | Yearly (confirmed) | $59.99/year |
| `com.marshandbarb.kandi.plus.founding` | Founding monthly | $4.99/mo |

iOS must never show Stripe or any outside-payment link. A membership bought on the website still unlocks Kandi+ in the app.
