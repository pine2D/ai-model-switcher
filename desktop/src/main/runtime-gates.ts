import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { app, type BrowserWindow } from "electron";

import type { LayoutState } from "../shared/protocol";
import { buildDiagnosticSnapshot, type DiagnosticSiteInput } from "./diagnostics";
import {
  StabilityMonitor,
  type StabilityEventInput,
  type StabilityMetric,
  type StabilitySummary
} from "./stability-monitor";

// 只声明诊断快照需要的最小面，不反向依赖 ViewManager 整个模块。
export interface DiagnosticSource {
  getDiagnosticSites(): DiagnosticSiteInput[];
  getLayout(): LayoutState;
}

interface RuntimeGates {
  readonly record: (event: StabilityEventInput) => void;
  readonly writeDiagnostic: (source: DiagnosticSource) => void;
  readonly dispose: () => void;
}

function metrics(): StabilityMetric[] {
  return app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    cpuPercent: metric.cpu.percentCPUUsage,
    workingSetKb: metric.memory.workingSetSize,
    peakWorkingSetKb: metric.memory.peakWorkingSetSize
  }));
}

function appendJson(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function durationFromEnvironment(): number {
  const minutes = Number(process.env.POLYASK_SOAK_MINUTES ?? "60");
  if (!Number.isFinite(minutes) || minutes <= 0) return 60 * 60_000;
  return Math.min(24 * 60 * 60_000, Math.max(1_000, minutes * 60_000));
}

export function startRuntimeGates(window: BrowserWindow): RuntimeGates {
  const diagnosticPath = process.env.POLYASK_DIAGNOSTICS_FILE;
  const reportPath = process.env.POLYASK_SOAK_REPORT;
  const monitor = new StabilityMonitor();
  let interval: NodeJS.Timeout | null = null;
  let completion: NodeJS.Timeout | null = null;
  let finished = false;

  const takeSample = () => {
    const sample = monitor.sample(metrics());
    if (reportPath) appendJson(reportPath, sample);
  };
  const finish = () => {
    if (!reportPath || finished) return;
    finished = true;
    if (interval) clearInterval(interval);
    takeSample();
    const summary: StabilitySummary = monitor.summary();
    appendJson(reportPath, summary);
    process.exitCode = summary.failures.length > 0 ? 1 : 0;
    app.quit();
  };

  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, "", "utf8");
    takeSample();
    interval = setInterval(takeSample, 60_000);
    completion = setTimeout(finish, durationFromEnvironment());
  }
  const record = (event: StabilityEventInput) => {
    const recorded = monitor.record(event);
    if (reportPath) appendJson(reportPath, recorded);
  };
  window.on("unresponsive", () => record({ type: "unresponsive", code: "shell" }));
  window.webContents.on("render-process-gone", (_event, details) => {
    record({ type: "render-process-gone", code: `shell:${details.reason}` });
  });

  return {
    record,
    writeDiagnostic: (source) => {
      if (!diagnosticPath) return;
      mkdirSync(dirname(diagnosticPath), { recursive: true });
      const snapshot = buildDiagnosticSnapshot({
        shellId: window.webContents.id,
        sites: source.getDiagnosticSites(),
        layout: source.getLayout()
      });
      writeFileSync(diagnosticPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    },
    dispose: () => {
      if (interval) clearInterval(interval);
      if (completion) clearTimeout(completion);
    }
  };
}
