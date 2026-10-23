const path = require("node:path");
const { tests } = require("@iobroker/testing");

// Smoke-test that the adapter can start under a real ioBroker controller.
// Credentials are intentionally not provided, so startup must stop before
// attempting to contact the MCZ cloud.
tests.integration(path.join(__dirname, ".."));
