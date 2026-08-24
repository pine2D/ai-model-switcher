import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DISPLAY_PREFERENCES,
  metricsForDensity,
  parseDisplayPreferences,
  zoomForSite
} from "../src/shared/display";
import {
  loadDisplayPreferences,
  saveDisplayPreferences,
  type DisplayStorage
} from "../src/renderer/display-preferences";

class MemoryStorage implements DisplayStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("display preferences accept only supported density and scale", () => {
  assert.deepEqual(parseDisplayPreferences({ density: "compact", siteScale: 0.9 }), {
    density: "compact",
    siteScale: 0.9
  });
  assert.deepEqual(parseDisplayPreferences({ density: "comfortable", siteScale: 1 }), {
    density: "comfortable",
    siteScale: 1
  });
  assert.equal(parseDisplayPreferences({ density: "tiny", siteScale: 0.9 }), null);
  assert.equal(parseDisplayPreferences({ density: "compact", siteScale: 0.8 }), null);
});

test("density metrics reserve only the approved shell and tile chrome", () => {
  assert.deepEqual(metricsForDensity("compact"), {
    shellHeight: 52,
    tileHeaderHeight: 24,
    edgeGap: 4,
    viewGap: 4
  });
  assert.deepEqual(metricsForDensity("comfortable"), {
    shellHeight: 64,
    tileHeaderHeight: 32,
    edgeGap: 8,
    viewGap: 8
  });
});

test("fit scale keeps only a focused primary at one hundred percent", () => {
  assert.equal(zoomForSite(DEFAULT_DISPLAY_PREFERENCES, "overview", false), 0.9);
  assert.equal(zoomForSite(DEFAULT_DISPLAY_PREFERENCES, "focus", true), 1);
  assert.equal(zoomForSite(DEFAULT_DISPLAY_PREFERENCES, "focus", false), 0.9);
  assert.equal(zoomForSite({ density: "compact", siteScale: 1 }, "focus", false), 1);
});

test("stored display preferences survive reload and malformed values fall back", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadDisplayPreferences(storage, false), DEFAULT_DISPLAY_PREFERENCES);
  assert.deepEqual(loadDisplayPreferences(storage, true), {
    density: "comfortable",
    siteScale: 0.9
  });

  assert.equal(saveDisplayPreferences(storage, { density: "comfortable", siteScale: 1 }), true);
  assert.deepEqual(loadDisplayPreferences(storage, false), {
    density: "comfortable",
    siteScale: 1
  });

  storage.setItem("polyask.display", "{broken");
  assert.deepEqual(loadDisplayPreferences(storage, true), DEFAULT_DISPLAY_PREFERENCES);
  assert.equal(saveDisplayPreferences(storage, { density: "tiny", siteScale: 0.9 }), false);
  assert.equal(storage.getItem("polyask.display"), "{broken");
});
