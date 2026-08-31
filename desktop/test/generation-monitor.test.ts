import assert from "node:assert/strict";
import test from "node:test";

import { GenerationMonitor } from "../src/main/generation-monitor";

function reachComplete(monitor: GenerationMonitor, runId: string, site: "claude" | "gemini"): void {
  monitor.accept(runId, site, "generating");
  monitor.accept(runId, site, "complete");
  monitor.accept(runId, site, "complete");
  monitor.accept(runId, site, "complete");
}

test("completion is accepted only after the same run observed generation", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "complete"), "submitted");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  reachComplete(monitor, "run-1", "claude");
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
  reachComplete(monitor, "run-1", "claude");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "complete");
  assert.equal(monitor.accept("run-1", "chatgpt", "generating"), null);
});

test("a single complete reading never settles the terminal phase", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
});

test("resumed generation between complete readings restarts the debounce", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.accept("run-1", "claude", "generating");
  monitor.accept("run-1", "claude", "complete");
  monitor.accept("run-1", "claude", "complete");
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
});

test("probes that read nothing neither confirm nor reset the debounce", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.accept("run-1", "claude", "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", null), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "generating");
  assert.equal(monitor.accept("run-1", "claude", "complete"), "complete");
});

test("retrying the same run keeps every existing site entry", () => {
  const monitor = new GenerationMonitor();
  assert.equal(monitor.begin("run-1", ["claude", "gemini"]), false);
  monitor.accept("run-1", "claude", "generating");
  assert.equal(monitor.begin("run-1", ["gemini"]), true);
  assert.equal(monitor.accept("run-1", "claude", "generating"), "generating");
  assert.equal(monitor.accepts("run-1", "claude"), true);
  assert.equal(monitor.accepts("run-1", "gemini"), true);
});

test("a resumed run adds only the sites it is missing", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.accept("run-1", "claude", "generating");
  reachComplete(monitor, "run-1", "claude");
  assert.equal(monitor.begin("run-1", ["claude", "gemini"]), true);
  assert.equal(monitor.accept("run-1", "claude", "idle"), "complete");
  assert.equal(monitor.accept("run-1", "gemini", "idle"), "submitted");
});

test("invalidating a run rejects every late probe", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude"]);
  monitor.invalidate();
  assert.equal(monitor.accept("run-1", "claude", "generating"), null);
});

test("a cancelled run cannot be resumed and restarts from the retried sites", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini"]);
  monitor.invalidate();
  assert.equal(monitor.begin("run-1", ["gemini"]), false);
  assert.equal(monitor.accepts("run-1", "gemini"), true);
  assert.equal(monitor.accepts("run-1", "claude"), false);
});

test("forgetting one site leaves the rest of the run watched", () => {
  const monitor = new GenerationMonitor();
  monitor.begin("run-1", ["claude", "gemini"]);
  monitor.forget("claude");
  assert.equal(monitor.accepts("run-1", "claude"), false);
  assert.equal(monitor.accept("run-1", "claude", "generating"), null);
  assert.equal(monitor.accepts("run-1", "gemini"), true);
});
