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

export function resolveLayoutMode(
  requested: "overview" | "focus",
  windowWidth: number
): "overview" | "focus" {
  return windowWidth < 1_200 ? "focus" : requested;
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
  const availableWidth = Math.max(0, area.width - gap);
  const primaryWidth = Math.floor(availableWidth * 0.7);
  const railWidth = availableWidth - primaryWidth;
  const primary: ViewPlacement = {
    key: focused,
    bounds: {
      x: area.x,
      y: area.y,
      width: primaryWidth,
      height: area.height
    }
  };
  const rail = grid(
    secondary,
    {
      x: area.x + primaryWidth + gap,
      y: area.y,
      width: railWidth,
      height: area.height
    },
    2,
    gap
  );

  return [primary, ...rail];
}
