# Kandi native apps (iOS + Android)

This folder is a [Capacitor](https://capacitorjs.com/) wrapper around the hosted Kandi web app. It uses the black + neon orange icon and splash, bundle id `com.marshandbarb.kandi`, and a standalone WebView that loads the HTTPS URL in `hosted-url.txt`.

The wrapper does **not** ship a second copy of the Node server. Sign-in, profiles, chat, and photos all live on the hosted backend (Neon). Change `hosted-url.txt` to the permanent Render (or other) URL before any TestFlight or store build. Then run `npx cap sync`.

No developer accounts were created for you. A Mac is not required if you use a cloud build.

## Accounts Boston needs

| Account | Cost | Required for | Notes |
|---|---|---|---|
| Apple ID | Free | Everything Apple | He almost certainly has one. |
| [Apple Developer Program](https://developer.apple.com/programs/) | **$99 / year** | TestFlight, App Store, signing | Enroll as an individual (or a company if he has a legal entity). Apple can take 24–48 hours, sometimes longer, to approve enrollment. This is the only paid Apple requirement. |
| Cloud build (pick one) | Free tier is enough to start | Building the `.ipa` without a Mac | **Codemagic** (recommended for Capacitor): free tier is typically 500 macOS minutes / month. Or **GitHub Actions** `macos-14` runners (private-repo minutes are limited; macOS minutes count at a higher rate). Do **not** pay for Expo EAS unless we later rewrite this as an Expo app — EAS is for Expo/React Native, not Capacitor. |
| [App Store Connect](https://appstoreconnect.apple.com) | Included with the Developer Program | TestFlight groups, App Store listing, privacy nutrition labels | Same Apple ID as the Developer Program. |
| Google Play Console (optional, Android) | **$25 one-time** | Publishing on Play | Cheap and worth doing once iOS works. Internal testing does not need a review as strict as production. |

Do not create these accounts from this machine. Boston should enroll himself, then share Team ID / issuer / app-specific API key with the cloud build (or enter them in the Codemagic / GitHub UI). Never commit `.p8`, `.p12`, or provisioning profiles.

## Point the app at the live URL

1. Edit `hosted-url.txt` so the first non-comment line is the live HTTPS origin (no trailing path).
2. `cd mobile && npm install && npx cap sync`
3. Rebuild.

Until a lasting host exists, the file points at the temporary 72h preview `https://workspace-ndancq.openpouch.sh`, which expires and may not have the latest Neon-backed build.

## Local generate (optional, needs a Mac for iOS run)

```bash
cd /workspace/kandi-app/mobile
npm install
npx cap add ios      # already added if the ios/ folder is present
npx cap add android  # already added if the android/ folder is present
npx npm run assets   # writes icons + splashes into the native projects
npx cap sync
```

Opening Xcode (`npx cap open ios`) only works on a Mac. Cloud build is the path that needs no Mac.

## Path to TestFlight (no Mac)

### A. Enroll in Apple Developer

1. On an iPhone or the [Apple Developer site](https://developer.apple.com/programs/), sign in with his Apple ID and enroll in the Apple Developer Program ($99/year).
2. Wait for Apple’s email that the membership is active.
3. In [App Store Connect](https://appstoreconnect.apple.com) → Users and Access → Integrations → App Store Connect API, create an **API key** with the App Manager or Admin role. Download the `.p8` once, and note the Key ID and Issuer ID. Keep the file off git.
4. In App Store Connect, create the app: name **Kandi**, bundle id **com.marshandbarb.kandi** (create that identifier first under Certificates, Identifiers & Profiles if it is not listed), primary language English (US), SKU something like `kandi-ios`.

### B. Codemagic (recommended)

1. Create a free [Codemagic](https://codemagic.io) account (GitHub or email). Connect the Kandi git repo.
2. New app → point it at this repo. Use the `mobile/codemagic.yaml` workflow (set the working directory / yaml path to `mobile/codemagic.yaml`).
3. In Codemagic settings, add code signing: App Store Connect API key (the `.p8`, Key ID, Issuer ID) and let Codemagic manage certificates and the `com.marshandbarb.kandi` profile.
4. Confirm `hosted-url.txt` is the lasting production URL, then start the **kandi_ios** workflow.
5. When the build succeeds, Codemagic uploads the `.ipa` to App Store Connect (TestFlight).
6. In App Store Connect → TestFlight, add Boston as an internal tester (his Apple ID email). On his iPhone, install the **TestFlight** app from the App Store, accept the invite, and install Kandi.

Internal TestFlight usually becomes available within a few minutes to an hour after processing. It does not need App Review. External testers (people outside his App Store Connect users) do need a brief Beta App Review the first time.

### C. GitHub Actions alternative

A starter workflow is in `.github/workflows/ios-build.yml`. It needs repo secrets `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and `APP_STORE_CONNECT_API_KEY` (the `.p8` contents), plus a GitHub account with Actions enabled. Use this if he already prefers GitHub and does not want a second dashboard.

## App Store review — what can get Kandi rejected

Apple will review a store build against the [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/). The ones that matter most here:

**4.2 Minimum Functionality (the main risk).** A thin WebView that only opens a website is often rejected as “not enough native functionality” or “just a website.” This wrapper is in that danger zone. Mitigations already in the project: native icon and splash, black status bar, standalone (no Safari chrome), and the full Kandi product inside the view (accounts, Discover, likes, matches, chat, events, report/block, account deletion). If Apple still rejects it, the next step is to add a few truly native pieces (push notification permission + device notifications for new matches, Sign in with Apple, or bundling the UI assets in the app binary instead of loading a remote URL). Do not submit a build whose `server.url` is a soon-to-expire preview link.

**Dating / social (Guideline 1.2 and 5.1.1).** Dating apps must have a way to report and block users (Kandi already does, from a profile). Reviewers sometimes check that those controls actually work.

**Age rating 17+.** In App Store Connect, set the age rating to **17+** (frequent/intense Mature/Suggestive Themes, and dating). The in-app gate is 18+. That is consistent: 17+ is the store’s highest bucket; the app itself still refuses under-18 signups. In the Age Rating questionnaire, be honest about sexual content and user-generated photos.

**Privacy nutrition labels and a privacy policy URL.** App Store Connect requires a publicly reachable privacy policy URL. Use `https://<hosted-origin>/privacy` once the host is stable. Also fill the privacy nutrition labels: we collect name, user ID, photos, messages, and other user-generated content, used for the app’s functionality, not for tracking. The privacy policy is in the web app at `/privacy`. Update it with a real support email before submission.

**Account deletion (Guideline 5.1.1).** Users must be able to initiate account deletion *in the app*. This is on the You tab: Delete account, then type the username and `DELETE`. It removes the profile, photos, likes, matches, and messages. Demo profiles cannot be deleted. Apple has rejected dating apps that only offer deletion by email.

**Sign in with Apple.** If we later add a third-party social login (Google, Facebook, etc.), Apple requires Sign in with Apple as an option. Username + password only does **not** require it today. Prefer to keep it that way until we are ready to add both.

**In-app purchases (3.1.1).** Kandi+ / VIP are stubs and do not charge. Before any real paid upgrade ships on iOS, it must go through StoreKit / IAP, not Stripe in a WebView. Leave the stub clearly labeled until then, and do not market paid features in the store listing until IAP works.

**Other listing must-haves.** Support URL (can be the same host, or `/privacy` until a support page exists). A real support email in App Store Connect. Accurate screenshots from an iPhone (black + neon orange UI). No placeholder “lorem ipsum” in the listing. Export compliance: HTTPS only, so usually the standard exemption applies.

## Android (optional, cheap)

The same Capacitor project can build an Android App Bundle. Codemagic’s Android workflow in `codemagic.yaml` can sign with a Play upload key (create one in the Codemagic UI; $25 Play Console). Internal testing tracks let Boston install from Play without a full production review.

## What was not done here

- No Apple, Codemagic, Expo, or Google accounts were created.
- No store listing was submitted.
- The iOS/Android projects are generated locally when `npx cap add` has been run; a signed `.ipa` still needs Boston’s Developer enrollment and a cloud (or Mac) build.
