import type {
  LayoutOptions,
  SiteKey,
  ViewBounds,
  ViewPlacement
} from "../shared/contracts";

interface Track {
  readonly start: number;
  readonly size: number;
}

const WIDE_FOCUS_MIN = 1_440;
const GRID_TILE_MIN_WIDTH = 380;
const GRID_TILE_MIN_HEIGHT = 210;

export function resolveLayoutMode(
  requested: "overview" | "focus",
  area: ViewBounds,
  gap = 4
): "overview" | "focus" {
  if (requested === "focus") return "focus";
  const safeGap = Math.max(0, Math.floor(gap));
  const tileWidth = (area.width - safeGap * 2) / 3;
  const tileHeight = (area.height - safeGap * 2) / 3;
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

  if (options.mode === "overview") return grid(keys, area, 3, gap);

  const focused = keys.includes(options.focused) ? options.focused : keys[0];
  const secondary = keys.filter((key) => key !== focused);
  const wide = area.width >= WIDE_FOCUS_MIN;
  const columns = wide ? 4 : 3;
  const rows = wide ? 3 : 4;
  const xTracks = splitAxis(area.x, area.width, columns, gap);
  const yTracks = splitAxis(area.y, area.height, rows, gap);
  const secondarySlots: readonly [number, number][] = wide
    ? [[2, 0], [3, 0], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [3, 2]]
    : [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2], [0, 3], [1, 3], [2, 3]];
  const primary: ViewPlacement = {
    key: focused,
    bounds: trackBounds(xTracks, yTracks, 0, 0, 2, 2)
  };
  const rail = secondary.map((key, index) => {
    const [column, row] = secondarySlots[index];
    return { key, bounds: trackBounds(xTracks, yTracks, column, row) };
  });

  return [primary, ...rail];
}
