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
  setPendingImages(list);
  verifyImages(pendingImages); // F092：魔数 + 解码校验前移到选图时刻，别等开窗后六站各报一次 image_invalid
  return true;
}
// 只在环境具备字节读取能力时深度校验（真实 File 皆支持 .slice/.arrayBuffer）；测试/受限环境读不到
// 字节就放行——宁可漏检也不能把不支持该 API 的宿主环境误判成坏图，content/upload.js 仍会兜底校验。
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
async function isValidImage(file) {
  if (typeof file.slice !== "function") return true;
  try {
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const png = bytes.length >= 8 && PNG_SIG.every((v, i) => bytes[i] === v);
    const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (file.type === "image/png" ? !png : !jpeg) return false;
    const bitmap = await createImageBitmap(file);
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
    return true;
  } catch (e) { return false; }
}
// list 是 setPendingImages 落地的那个数组引用：只在校验完成时仍是"当前选择"才生效，
// 避免用户在校验期间又选了新一批，异步结果回来时把新选择错误地清空。
async function verifyImages(list) {
  const ok = (await Promise.all(list.map(isValidImage))).every(Boolean);
  if (!ok && pendingImages === list) { setPendingImages([]); flashNote(t("con_imageType")); }
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
