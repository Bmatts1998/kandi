const fs = require("fs");
const path = require("path");

function hostedUrl() {
  const file = path.join(__dirname, "hosted-url.txt");
  const fallback = "https://workspace-ndancq.openpouch.sh";
  if (!fs.existsSync(file)) return fallback;
  const line = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  return line || fallback;
}

const url = hostedUrl();

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: "com.marshandbarb.kandi",
  appName: "Kandi",
  webDir: "www",
  server: {
    url,
    cleartext: false,
    allowNavigation: [
      "workspace-ndancq.openpouch.sh",
      "*.openpouch.sh",
      "*.onrender.com",
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1400,
      launchAutoHide: true,
      backgroundColor: "#000000",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#000000",
    },
    // Next native iOS build (DAT-20 + Declared Age Range):
    // - cd mobile && npm ci && npx cap sync ios
    // - Install @capacitor/keyboard, then cap sync (config is already here).
    // - In Xcode: Signing & Capabilities → + Capability → Declared Age Range
    //   (com.apple.developer.declared-age-range is already in App.entitlements).
    // - Apple Developer portal: App ID com.marshandbarb.kandi → enable
    //   Declared Age Range, regenerate the provisioning profile, archive
    //   with Xcode 26+. iOS 26+ is required for the system age sheet;
    //   older iOS is allowed through and marked unverified.
    // - AVAudioSession .playback is already in AppDelegate.
    // - contentInset "never" is already set below.
    // - Still open: branded cold-start page, StoreKit in-app purchases.
    // resize: "none" stops WKWebView from resizing the whole app when the
    // keyboard opens (that resize fights the chat log). The web chat screen
    // already insets the composer with visualViewport + --kb.
    Keyboard: {
      resize: "none",
      resizeOnFullScreen: false,
    },
  },
  ios: {
    scheme: "Kandi",
    contentInset: "never",
    preferredContentMode: "mobile",
    backgroundColor: "#000000",
  },
  android: {
    backgroundColor: "#000000",
    allowMixedContent: false,
  },
};

module.exports = config;
