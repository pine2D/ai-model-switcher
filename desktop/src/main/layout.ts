import type {
  LayoutOptions,
  SiteKey,
  ViewBounds,
  ViewPlacement
} from "../shared/contracts";
import { SITE_PAGE_SIZE } from "../shared/site-pages";
export {
  paginateSiteKeys,
  resolveSitePage,
  resolveSitePageIndex,
  SITE_PAGE_SIZE
} from "../shared/site-pages";

interface Track {
  readonly start: number;
  readonly size: number;
}

const GRID_TILE_MIN_WIDTH = 380;
const GRID_TILE_MIN_HEIGHT = 210;

export function resolveLayoutMode(
  requested: "overview" | "focus",
  area: ViewBounds,
  gap = 4,
  count = SITE_PAGE_SIZE
): "overview" | "focus" {
  if (requested === "focus") return "focus";
  const safeGap = Math.max(0, Math.floor(gap));
  const safeCount = Math.max(1, Math.min(SITE_PAGE_SIZE, Math.floor(count)));
  const columns = safeCount <= 3 ? safeCount : safeCount === 4 ? 2 : 3;
  const rows = Math.ceil(safeCount / columns);
  const tileWidth = (area.width - safeGap * (columns - 1)) / columns;
  const tileHeight = (area.height - safeGap * (rows - 1)) / rows;
  return tileWidth < GRID_TILE_MIN_WIDTH || tileHeight < GRID_TILE_MIN_HEIGHT
    ? "focus"
    : "overview";
}

export function swapFocusedSite(
  order: readonly SiteKey[],
  current: SiteKey,
  next: SiteKey
): SiteKey[] {
  const result = [...order];
  const currentIndex = result.indexOf(current);
  const nextIndex = result.indexOf(next);
  if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex) return result;
  [result[currentIndex], result[nextIndex]] = [result[nextIndex], result[currentIndex]];
  return result;
}

export function scaleBounds(bounds: ViewBounds, factor: number): ViewBounds {
  const scale = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const x = Math.round(bounds.x * scale);
  const y = Math.round(bounds.y * scale);
  const right = Math.round((bounds.x + bounds.width) * scale);
  const bottom = Math.round((bounds.y + bounds.height) * scale);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function splitAxis(start: number, length: number, count: number, gap: number): Track[] {
  const usable = Math.max(0, Math.floor(length) - gap * (count - 1));
  const base = Math.floor(usable / count);
  let remainder = usable % count;
  let cursor = Math.floor(start);

  return Array.from({ length: count }, () => {
    const size = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const track = { start: cursor, size };
    cursor += size + gap;
    return track;
  });
}

function grid(
  keys: readonly SiteKey[],
  area: ViewBounds,
  columns: number,
  gap: number
): ViewPlacement[] {
  const rows = Math.max(1, Math.ceil(keys.length / columns));
  const xTracks = splitAxis(area.x, area.width, columns, gap);
  const yTracks = splitAxis(area.y, area.height, rows, gap);

  return keys.map((key, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      key,
      bounds: {
        x: xTracks[column].start,
        y: yTracks[row].start,
        width: xTracks[column].size,
        height: yTracks[row].size
      }
    };
  });
}

function overview(
  keys: readonly SiteKey[],
  area: ViewBounds,
  gap: number
): ViewPlacement[] {
  if (keys.length <= 3) return grid(keys, area, keys.length, gap);
  return grid(keys, area, 2, gap);
}

function trackBounds(
  xTracks: readonly Track[],
  yTracks: readonly Track[],
  column: number,
  row: number,
  columnSpan = 1,
  rowSpan = 1
): ViewBounds {
  const left = xTracks[column];
  const right = xTracks[column + columnSpan - 1];
  const top = yTracks[row];
  const bottom = yTracks[row + rowSpan - 1];
  return {
    x: left.start,
    y: top.start,
    width: right.start + right.size - left.start,
    height: bottom.start + bottom.size - top.start
  };
}

export function computeViewLayout(
  keys: readonly SiteKey[],
  area: ViewBounds,
  options: LayoutOptions
): ViewPlacement[] {
  if (keys.length === 0) return [];
  const gap = Math.max(0, Math.floor(options.gap ?? 8));
  const active = keys.slice(0, SITE_PAGE_SIZE);

  if (options.mode === "overview") return overview(active, area, gap);

  const focused = active.includes(options.focused) ? options.focused : active[0];
  const secondary = active.filter((key) => key !== focused);
  if (active.length === 1) return [{ key: focused, bounds: area }];

  const xTracks = splitAxis(area.x, area.width, 3, gap);
  const fullHeight = [{ start: area.y, size: area.height }];
  const primaryWidth = trackBounds(xTracks, fullHeight, 0, 0, 2);
  if (active.length === 2) {
    return [
      { key: focused, bounds: primaryWidth },
      { key: secondary[0], bounds: trackBounds(xTracks, fullHeight, 2, 0) }
    ];
  }

  const rows = secondary.length;
  const yTracks = splitAxis(area.y, area.height, rows, gap);
  const primary: ViewPlacement = {
    key: focused,
    bounds: trackBounds(xTracks, yTracks, 0, 0, 2, rows)
  };
  const rail = secondary.map((key, index) => ({
    key,
    bounds: trackBounds(xTracks, yTracks, 2, index)
  }));
  return [primary, ...rail];
}
