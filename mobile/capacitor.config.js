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
