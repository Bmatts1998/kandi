"use strict";

const { registerPlugin } = require("@capacitor/core");

const DeclaredAgeRange = registerPlugin("DeclaredAgeRange", {
  web: () => ({
    requestAgeRange: async () => ({ status: "unavailable", reason: "web" }),
  }),
});

module.exports = { DeclaredAgeRange };
