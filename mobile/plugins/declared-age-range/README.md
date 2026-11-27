# @kandi/declared-age-range

Local Capacitor 7 plugin that wraps Apple's DeclaredAgeRange framework
(`AgeRangeService.requestAgeRange(ageGates:in:)`). There is a third-party
package (`@capgo/capacitor-age-range`), but it requires Capacitor 8. Kandi
is on Capacitor 7, so this plugin lives in the repo.

The hosted web app calls it through `window.Capacitor.Plugins.DeclaredAgeRange`
and does not import this package.

## Native requirements

- iOS 26+ and Xcode 26+ for the system sheet to appear. On older iOS, or when
  compiled with an older SDK, `requestAgeRange()` resolves with
  `{ status: "unavailable" }` and no dialog.
- Entitlement `com.apple.developer.declared-age-range` on the App target, and
  the **Declared Age Range** capability enabled on the App ID in the Apple
  Developer portal. Then regenerate the provisioning profile and archive again.

Call:

```js
const result = await Capacitor.Plugins.DeclaredAgeRange.requestAgeRange({ ageGate: 18 });
// { status: "sharing"|"declined"|"unavailable", lowerBound?, upperBound?, declaration?, reason? }
```
