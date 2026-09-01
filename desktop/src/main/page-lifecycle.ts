export type PagePhase = "loading" | "ready" | "failed";

// 页面阶段状态机。抽成纯类是为了能离线回归——它守着两条真机踩过的坑：
//
// ① **只有主帧导航才算「开始加载」**。`did-start-loading` 反映整个 WebContents，而
//    `did-finish-load` 只对主帧发。站点加载完后随时会插入 iframe（Claude 的 hCaptcha /
//    isolated-segment，ChatGPT 的 about:blank），那会再触发一次 did-start-loading 却永远
//    等不到配对的 did-finish-load → phase 被永久钉死在 loading → 健康检查那条
//    「phase==='loading' 就不发 diagnose」的门禁从此恒真，站点状态恒 unknown。
//
// ② **失败不许被紧随其后的 did-finish-load 覆写**。主帧加载失败的实测事件序是
//    did-fail-load(isMainFrame) → did-finish-load → did-stop-loading，间隔 1~2ms。
//    不挡就会把 failed 洗回 ready，sendCommand 里「crashed/failed 直接报确定失败」的
//    保护随之失效，群发会对着一个加载不出来的页面空烧到截止线。
export class PageLifecycle {
  private phase: PagePhase = "loading";
  private failed = false;

  // ERR_ABORTED(-3) 是导航被新导航取代的正常产物，不是故障。
  static readonly ABORTED = -3;

  // 三个 on* 返回「本次事件产生的新阶段」，返回 null = 该事件不改变阶段、调用方不要通知。
  // 不做同阶段去重：view-manager 的 reload() 会自己写一次 loading，去重会让两套状态错开。
  startNavigation(isMainFrame: boolean, isSameDocument: boolean): PagePhase | null {
    if (!isMainFrame || isSameDocument) return null;
    this.failed = false;
    this.phase = "loading";
    return this.phase;
  }

  failLoad(code: number, isMainFrame: boolean): PagePhase | null {
    if (code === PageLifecycle.ABORTED || !isMainFrame) return null;
    this.failed = true;
    this.phase = "failed";
    return this.phase;
  }

  finishLoad(): PagePhase | null {
    if (this.failed) return null;
    this.phase = "ready";
    return this.phase;
  }

  current(): PagePhase {
    return this.phase;
  }
}
