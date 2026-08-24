import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_IMAGE_BYTES,
  unsupportedImageSites,
  validateImageFiles,
  validateImages,
  type DesktopImage
} from "../src/shared/images";
import { SITES } from "../src/main/sites";

function image(size: number, type: "image/png" | "image/jpeg" = "image/png"): DesktopImage {
  const bytes = Buffer.alloc(size);
  if (type === "image/png") Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  else Buffer.from([255, 216, 255]).copy(bytes);
  return {
    name: type === "image/png" ? "image.png" : "image.jpg",
    type,
    size,
    dataUrl: `data:${type};base64,${bytes.toString("base64")}`
  };
}

test("desktop accepts four valid PNG/JPEG files up to ten MiB total", () => {
  const quarter = MAX_IMAGE_BYTES / 4;
  const value = validateImages([
    image(quarter),
    image(quarter, "image/jpeg"),
    image(quarter),
    image(quarter, "image/jpeg")
  ]);
  assert.equal(value?.length, 4);
  assert.equal(value?.reduce((sum, item) => sum + item.size, 0), MAX_IMAGE_BYTES);
});

test("desktop rejects count, total size, declared length and mismatched signatures", () => {
  assert.equal(validateImages(Array.from({ length: 5 }, () => image(8))), null);
  assert.equal(validateImages([image(MAX_IMAGE_BYTES), image(8)]), null);
  assert.equal(validateImages([{ ...image(8), size: 7 }]), null);
  assert.equal(validateImages([{
    name: "x.png",
    type: "image/png",
    size: 3,
    dataUrl: "data:image/png;base64,QUJD"
  }]), null);
  assert.equal(validateImages([{ ...image(8), dataUrl: "data:image/jpeg;base64,/9j/" }]), null);
});

test("desktop image validation normalizes names and accepts an empty batch", () => {
  assert.deepEqual(validateImages(undefined), []);
  assert.equal(validateImages([{ ...image(8), name: "../folder\\safe.png" }])?.[0].name, "safe.png");
});

test("renderer file metadata fails fast before reading large payloads", () => {
  assert.equal(validateImageFiles([]), "image_count");
  assert.equal(validateImageFiles(Array.from({ length: 5 }, () => ({ type: "image/png", size: 8 }))), "image_count");
  assert.equal(validateImageFiles([{ type: "image/gif", size: 8 }]), "image_type");
  assert.equal(validateImageFiles([{ type: "image/png", size: MAX_IMAGE_BYTES + 1 }]), "image_size");
  assert.equal(validateImageFiles([{ type: "image/jpeg", size: 3 }]), null);
});

test("desktop derives unsupported image sites from the authoritative registry", () => {
  assert.deepEqual(
    unsupportedImageSites(["claude", "gemini", "qianwen", "chatglm"], SITES),
    ["gemini", "qianwen", "chatglm"]
  );
});
