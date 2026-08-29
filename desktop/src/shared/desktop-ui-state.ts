import { SITE_KEYS, type SiteKey } from "./contracts";
import { paginateSiteKeys } from "./site-pages";

export interface DesktopBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopUiState {
  readonly windowBounds?: DesktopBounds;
  readonly maximized: boolean;
  readonly layoutMode: "overview" | "focus";
  readonly currentPage: number;
  readonly focusedByPage: Readonly<Record<number, SiteKey>>;
}

const MIN_WIDTH = 960;
const MIN_HEIGHT = 680;
const KNOWN_SITES = new Set<string>(SITE_KEYS);

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function intersectionArea(left: DesktopBounds, right: DesktopBounds): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

function parseBounds(value: unknown, displays: readonly DesktopBounds[]): DesktopBounds | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<DesktopBounds>;
  const x = finiteInteger(candidate.x);
  const y = finiteInteger(candidate.y);
  const requestedWidth = finiteInteger(candidate.width);
  const requestedHeight = finiteInteger(candidate.height);
  if (x === null || y === null || requestedWidth === null || requestedHeight === null) return undefined;
  const available = displays.filter((item) => item.width > 0 && item.height > 0);
  if (!available.length) {
    return { x, y, width: Math.max(MIN_WIDTH, requestedWidth), height: Math.max(MIN_HEIGHT, requestedHeight) };
  }
  const primary = available[0];
  const requested = {
    x,
    y,
    width: Math.max(MIN_WIDTH, requestedWidth),
    height: Math.max(MIN_HEIGHT, requestedHeight)
  };
  const target = available.reduce((best, display) =>
    intersectionArea(requested, display) > intersectionArea(requested, best) ? display : best
  , primary);
  const width = Math.min(requested.width, target.width);
  const height = Math.min(requested.height, target.height);
  if (intersectionArea(requested, target) === 0) {
    return {
      x: target.x + Math.round((target.width - width) / 2),
      y: target.y + Math.round((target.height - height) / 2),
      width,
      height
    };
  }
  return {
    x: clamp(x, target.x, target.x + target.width - width),
    y: clamp(y, target.y, target.y + target.height - height),
    width,
    height
  };
}

export function parseDesktopUiState(
  value: unknown,
  displays: readonly DesktopBounds[],
  selectedSites: readonly SiteKey[]
): DesktopUiState {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const pages = paginateSiteKeys(selectedSites);
  const requestedPage = finiteInteger(candidate.currentPage);
  const currentPage = requestedPage !== null && requestedPage >= 0 && requestedPage < pages.length
    ? requestedPage
    : 0;
  const storedFocus = candidate.focusedByPage && typeof candidate.focusedByPage === "object"
    ? candidate.focusedByPage as Record<string, unknown>
    : {};
  const focusedByPage: Record<number, SiteKey> = {};
  pages.forEach((sites, page) => {
    const remembered = storedFocus[String(page)];
    if (typeof remembered === "string" && KNOWN_SITES.has(remembered) && sites.includes(remembered as SiteKey)) {
      focusedByPage[page] = remembered as SiteKey;
    } else if (sites[0]) {
      focusedByPage[page] = sites[0];
    }
  });
  const windowBounds = parseBounds(candidate.windowBounds, displays);
  return {
    ...(windowBounds ? { windowBounds } : {}),
    maximized: candidate.maximized === true,
    layoutMode: candidate.layoutMode === "focus" ? "focus" : "overview",
    currentPage,
    focusedByPage
  };
}
