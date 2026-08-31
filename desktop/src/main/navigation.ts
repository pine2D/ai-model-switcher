import type { SiteDefinition } from "../shared/contracts";

export type NavigationDisposition = "site" | "auth" | "transit" | "external" | "block";

export function navigationDisposition(
  site: SiteDefinition,
  rawUrl: string
): NavigationDisposition {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "block";
  }
  if (url.protocol !== "https:") return "block";
  if (url.hostname === site.host) return "site";
  if (site.authHosts.includes(url.hostname)) return "auth";
  // 一方基础设施的中转域（如 Google 的 www.google.com/sorry 反滥用页、consent.google.com
  // 同意页）：站点加载/登录链里可能被服务端 302 经过，但不是登录域本身。它只作为服务端
  // 重定向的中间跳板放行，不进登录流、不放行渲染端主动导航过去（见 navigation-guard）。
  if (site.transitHosts?.includes(url.hostname)) return "transit";
  return "external";
}
