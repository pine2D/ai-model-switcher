import type { SiteKey } from "./contracts";

export const SITE_PAGE_SIZE = 6;

export function paginateSiteKeys(
  keys: readonly SiteKey[],
  pageSize = SITE_PAGE_SIZE
): SiteKey[][] {
  const size = Math.max(1, Math.floor(pageSize));
  if (keys.length === 0) return [[]];
  const pages: SiteKey[][] = [];
  for (let index = 0; index < keys.length; index += size) {
    pages.push(keys.slice(index, index + size));
  }
  return pages;
}

export function resolveSitePage(
  keys: readonly SiteKey[],
  requestedPage: number
): { readonly page: number; readonly pageCount: number; readonly keys: readonly SiteKey[] } {
  const pages = paginateSiteKeys(keys);
  const page = Math.max(0, Math.min(Math.floor(requestedPage), pages.length - 1));
  return { page, pageCount: pages.length, keys: pages[page] };
}

export function resolveFocusedSite(
  pageKeys: readonly SiteKey[],
  current: SiteKey,
  remembered?: SiteKey
): SiteKey {
  if (pageKeys.includes(current)) return current;
  if (remembered && pageKeys.includes(remembered)) return remembered;
  return pageKeys[0] ?? current;
}
