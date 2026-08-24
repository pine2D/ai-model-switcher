import type { SiteDefinition } from "../shared/contracts";

export type NavigationDisposition = "site" | "auth" | "external" | "block";

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
  return "external";
}
