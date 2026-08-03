const assert = require("node:assert/strict");
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

assert.ok(manifest.permissions.includes("identity") && manifest.permissions.includes("alarms"));
assert.deepEqual(manifest.host_permissions, ["https://www.googleapis.com/*"]);
