import type { SiteDefinition, SiteKey } from "./contracts";

export const MAX_IMAGE_COUNT = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

export type DesktopImageType = (typeof IMAGE_TYPES)[number];

export interface DesktopImage {
  readonly name: string;
  readonly type: DesktopImageType;
  readonly size: number;
  readonly dataUrl: string;
}

export type ImageInputError = "image_count" | "image_type" | "image_size" | "image_invalid";

interface ImageFileMetadata {
  readonly type: string;
  readonly size: number;
}

const IMAGE_TYPE_SET = new Set<string>(IMAGE_TYPES);
const DATA_URL = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

function safeName(value: unknown, type: DesktopImageType): string {
  const fallback = type === "image/png" ? "image.png" : "image.jpg";
  const leaf = String(value ?? "").split(/[\\/]/).pop()?.trim() || fallback;
  return [...leaf].slice(0, 128).join("") || fallback;
}

function hasSignature(raw: string, type: DesktopImageType): boolean {
  if (type === "image/png") {
    const png = [137, 80, 78, 71, 13, 10, 26, 10];
    return raw.length >= png.length && png.every((byte, index) => raw.charCodeAt(index) === byte);
  }
  return raw.length >= 3 && raw.charCodeAt(0) === 255 &&
    raw.charCodeAt(1) === 216 && raw.charCodeAt(2) === 255;
}

export function validateImageFiles(files: readonly ImageFileMetadata[]): ImageInputError | null {
  if (files.length < 1 || files.length > MAX_IMAGE_COUNT) return "image_count";
  if (files.some((file) => !IMAGE_TYPE_SET.has(file.type))) return "image_type";
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.some((file) => !Number.isSafeInteger(file.size) || file.size < 1) ||
      total > MAX_IMAGE_BYTES) return "image_size";
  return null;
}

export function unsupportedImageSites(
  selected: readonly SiteKey[],
  definitions: readonly SiteDefinition[]
): SiteKey[] {
  const support = new Map(definitions.map((site) => [site.key, site.image]));
  return selected.filter((site) => support.get(site) !== true);
}

export function validateImages(value: unknown): DesktopImage[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGE_COUNT) return null;
  const images: DesktopImage[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    if (!IMAGE_TYPE_SET.has(String(candidate.type))) return null;
    const type = candidate.type as DesktopImageType;
    if (!Number.isSafeInteger(candidate.size) || Number(candidate.size) < 1) return null;
    const size = Number(candidate.size);
    total += size;
    if (size > MAX_IMAGE_BYTES || total > MAX_IMAGE_BYTES) return null;
    if (typeof candidate.dataUrl !== "string" ||
        candidate.dataUrl.length > Math.ceil(size * 4 / 3) + 64) return null;
    const match = DATA_URL.exec(candidate.dataUrl);
    if (!match || match[1] !== type) return null;
    try {
      const raw = atob(match[2]);
      if (raw.length !== size || !hasSignature(raw, type)) return null;
    } catch {
      return null;
    }
    images.push({ name: safeName(candidate.name, type), type, size, dataUrl: candidate.dataUrl });
  }
  return images;
}
