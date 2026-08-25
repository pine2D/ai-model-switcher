import assert from "node:assert/strict";
import test from "node:test";

import config from "../forge.config";

test("Forge config exposes one native maker per supported platform", () => {
  assert.equal(config.packagerConfig?.executableName, "polyask-desktop");
  const makers = config.makers ?? [];
  const byName = new Map(makers.map((maker) => ["name" in maker ? maker.name : "", maker]));

  assert.deepEqual(byName.get("@electron-forge/maker-squirrel")?.platforms, ["win32"]);
  assert.deepEqual(byName.get("@electron-forge/maker-deb")?.platforms, ["linux"]);
  assert.deepEqual(byName.get("@electron-forge/maker-zip")?.platforms, ["darwin"]);
});
