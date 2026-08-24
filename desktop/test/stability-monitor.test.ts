import assert from "node:assert/strict";
import test from "node:test";

import {
  StabilityMonitor,
  summarizeSamples,
  type StabilityEvent,
  type StabilitySample
} from "../src/main/stability-monitor";

function sample(timestamp: number, workingSetKb: number, peakWorkingSetKb = workingSetKb): StabilitySample {
  return {
    kind: "sample",
    timestamp,
    metrics: [{ pid: 1, type: "Browser", cpuPercent: 2, workingSetKb, peakWorkingSetKb }]
  };
}

test("soak summary reports growth and renderer failures", () => {
  const events: StabilityEvent[] = [
    { kind: "event", timestamp: 1_500, type: "did-fail-load", site: "gemini", code: "-105" },
    { kind: "event", timestamp: 1_600, type: "render-process-gone", site: "kimi", code: "crashed" }
  ];
  const summary = summarizeSamples([sample(1_000, 100, 110), sample(2_000, 145, 160)], events);

  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.workingSetGrowthKb, 45);
  assert.equal(summary.peakWorkingSetKb, 160);
  assert.equal(summary.events.length, 2);
  assert.deepEqual(summary.failures.map((event) => event.site), ["kimi"]);
});

test("stability monitor preserves chronological samples and events", () => {
  const monitor = new StabilityMonitor();
  monitor.sample(sample(2_000, 120).metrics, 2_000);
  monitor.record({ type: "unresponsive", code: "shell" }, 2_100);
  monitor.sample(sample(3_000, 125).metrics, 3_000);

  const summary = monitor.summary();
  assert.equal(summary.durationMs, 1_000);
  assert.equal(summary.failures[0]?.type, "unresponsive");
  assert.equal(summary.workingSetGrowthKb, 5);
});
