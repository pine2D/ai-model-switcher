// console/images.js — 仅驻内存的多图选择、校验与消息载荷转换。
const elImage = document.getElementById("image");
const elImageInput = document.getElementById("image-input");
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
let pendingImages = [];

function setPendingImages(files, announce = true) {
  pendingImages = [...(files || [])];
  const total = pendingImages.reduce((sum, file) => sum + file.size, 0);
  const detail = pendingImages.length
    ? t("con_imageDetail", pendingImages.length, (total / 1048576).toFixed(1)) : "";
  const label = pendingImages.length ? t("con_imageRemove", detail) : t("con_imageAdd");
  elImage.dataset.set = pendingImages.length ? "true" : "false";
  elImage.setAttribute("aria-pressed", String(!!pendingImages.length));
  elImage.title = label; elImage.setAttribute("aria-label", label);
  if (announce) flashNote(t(pendingImages.length ? "con_imageAdded" : "con_imageRemoved", detail));
}

function chooseImages(files) {
  const list = [...(files || [])];
  if (!list.length) return false;
  if (list.length > MAX_IMAGE_COUNT) { flashNote(t("con_imageCount")); return false; }
  if (list.some((file) => !IMAGE_TYPES.has(file.type))) { flashNote(t("con_imageType")); return false; }
  const total = list.reduce((sum, file) => sum + file.size, 0);
  if (list.some((file) => file.size < 1) || total > MAX_IMAGE_BYTES) {
    flashNote(t("con_imageSize")); return false;
  }
  setPendingImages(list); return true;
}

function imagePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}
function imagePayloads(files) { return Promise.all(files.map(imagePayload)); }

elImage.addEventListener("click", () => {
  if (pendingImages.length) setPendingImages([]);
  else { elImageInput.value = ""; elImageInput.click(); }
});
elImageInput.addEventListener("change", () => chooseImages(elImageInput.files));
document.getElementById("prompt").addEventListener("paste", (e) => {
  const files = [...((e.clipboardData && e.clipboardData.files) || [])]
    .filter((file) => file.type.startsWith("image/"));
  if (files.length) chooseImages(files);
});
