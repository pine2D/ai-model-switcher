import assert from "node:assert/strict";
import test from "node:test";

import { GenerationMonitor } from "../src/main/generation-monitor";

test("completion is accepted only after the same run observed generation", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "complete"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
  monitor.begin("run-2", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "complete"), null);
});

test("unsupported probes stay submitted and completed sites stay terminal", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini"]);
  assert.equal(monitor.accept("run-1", "claude", null), "submitted");
  assert.equal(monitor.accept("run-1", "gemini", "idle"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "complete");
  assert.equal(monitor.accept("run-1", "chatgpt", "generating"), null);
});

test("invalidating a run rejects every late probe", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.invalidate();
  assert.equal(monitor.accept("run-1", "claude", "generating"), null);
});
