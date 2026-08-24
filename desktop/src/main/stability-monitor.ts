import type { SiteKey } from "../shared/contracts";

export interface StabilityMetric {
  readonly pid: number;
  readonly type: string;
  readonly cpuPercent: number;
  readonly workingSetKb: number;
  readonly peakWorkingSetKb: number;
}

export interface StabilitySample {
  readonly kind: "sample";
  readonly timestamp: number;
  readonly metrics: readonly StabilityMetric[];
}

export type StabilityEventType = "did-fail-load" | "render-process-gone" | "unresponsive";

export interface StabilityEvent {
  readonly kind: "event";
  readonly timestamp: number;
  readonly type: StabilityEventType;
  readonly site?: SiteKey;
  readonly code?: string;
}

export type StabilityEventInput = Omit<StabilityEvent, "kind" | "timestamp">;

export interface StabilitySummary {
  readonly kind: "summary";
  readonly sampleCount: number;
  readonly durationMs: number;
  readonly workingSetStartKb: number;
  readonly workingSetEndKb: number;
  readonly workingSetGrowthKb: number;
  readonly peakWorkingSetKb: number;
  readonly events: readonly StabilityEvent[];
  readonly failures: readonly StabilityEvent[];
}

function total(metrics: readonly StabilityMetric[], key: "workingSetKb" | "peakWorkingSetKb"): number {
  return metrics.reduce((sum, metric) => sum + metric[key], 0);
}

export function summarizeSamples(
  samples: readonly StabilitySample[],
  events: readonly StabilityEvent[]
): StabilitySummary {
  const orderedSamples = [...samples].sort((left, right) => left.timestamp - right.timestamp);
  const orderedEvents = [...events].sort((left, right) => left.timestamp - right.timestamp);
  const first = orderedSamples[0];
  const last = orderedSamples.at(-1);
  const workingSetStartKb = first ? total(first.metrics, "workingSetKb") : 0;
  const workingSetEndKb = last ? total(last.metrics, "workingSetKb") : 0;
  const peakWorkingSetKb = orderedSamples.reduce(
    (peak, sample) => Math.max(peak, total(sample.metrics, "peakWorkingSetKb")),
    0
  );
  const failures = orderedEvents.filter((event) => event.type !== "did-fail-load");
  return {
    kind: "summary",
    sampleCount: orderedSamples.length,
    durationMs: first && last ? Math.max(0, last.timestamp - first.timestamp) : 0,
    workingSetStartKb,
    workingSetEndKb,
    workingSetGrowthKb: workingSetEndKb - workingSetStartKb,
    peakWorkingSetKb,
    events: orderedEvents,
    failures
  };
}

export class StabilityMonitor {
  private readonly samples: StabilitySample[] = [];
  private readonly events: StabilityEvent[] = [];

  sample(metrics: readonly StabilityMetric[], timestamp = Date.now()): StabilitySample {
    const sample = { kind: "sample" as const, timestamp, metrics: metrics.map((metric) => ({ ...metric })) };
    this.samples.push(sample);
    return sample;
  }

  record(event: StabilityEventInput, timestamp = Date.now()): StabilityEvent {
    const recorded = { kind: "event" as const, timestamp, ...event };
    this.events.push(recorded);
    return recorded;
  }

  summary(): StabilitySummary {
    return summarizeSamples(this.samples, this.events);
  }
}
