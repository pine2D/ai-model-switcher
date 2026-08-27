import type { SiteKey } from "./contracts";

export const SITE_PAGE_SIZE = 4;

export function paginateSiteKeys(
  keys: readonly SiteKey[],
  pageSize = SITE_PAGE_SIZE
): SiteKey[][] {
  const size = Math.max(1, Math.floor(pageSize));
  if (keys.length === 0) return [[]];
  const pageCount = Math.ceil(keys.length / size);
  const baseSize = Math.floor(keys.length / pageCount);
  let largerPages = keys.length % pageCount;
  const pages: SiteKey[][] = [];
  let start = 0;
  for (let page = 0; page < pageCount; page += 1) {
    const count = baseSize + (largerPages > 0 ? 1 : 0);
    largerPages = Math.max(0, largerPages - 1);
    pages.push(keys.slice(start, start + count));
    start += count;
  }
  return pages;
}

export function resolveSitePageIndex(
  keys: readonly SiteKey[],
  site: SiteKey
): number {
  const page = paginateSiteKeys(keys).findIndex((items) => items.includes(site));
  return page < 0 ? 0 : page;
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
