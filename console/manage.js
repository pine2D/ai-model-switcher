// console/manage.js — 模板的「命名」与「删除二次确认」两个细条内联交互。
// 之所以内联：96px 窗口会裁切 prompt()/confirm()/自定义浮层（实测）。
// 复用 console.js 的全局：templates / renderTemplates。本文件在 console.js 之后加载。

// —— 内联命名（替代被裁切的 prompt()）：点 ＋ 后在细条内就地起名 + 回车 ——
const elName = document.getElementById("nameinput");
let pendingSave = null; // {text}
let nameOpener = null;  // 触发命名的按钮：收尾归还焦点，键盘用户不必从头 Tab（blur 主动移开除外）
function startName(_kind, placeholder, payload) {
  cancelConfirm(false);                        // 与删除确认互斥
  nameOpener = document.activeElement;
  pendingSave = payload;
  elName.value = ""; elName.placeholder = placeholder;
  elName.style.display = ""; elName.focus();
}
function cancelName(restoreFocus) {
  pendingSave = null; elName.value = ""; elName.style.display = "none";
  if (restoreFocus && nameOpener) { try { nameOpener.focus(); } catch (e) {} }
  nameOpener = null;
}
function commitName() {
  if (!pendingSave) return;
  const name = elName.value.trim();
  templates = [...templates, { id: crypto.randomUUID(), name, text: pendingSave.text, updatedAt: Date.now() }];
  chrome.storage.local.set({ amsTemplates: templates });
  renderTemplates();
  cancelName(true);
}
elName.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commitName(); } // 输入法合成中不误存
  else if (e.key === "Escape") { e.preventDefault(); cancelName(true); }
});
elName.addEventListener("blur", () => { if (pendingSave) cancelName(false); }); // 失焦即取消（用户主动移开，不抢焦点）

// —— 删除二次确认：细条内联确认条（替代会被裁切的 confirm()/浮层）——
let pendingDelete = null; // {index}
let confirmOpener = null; // 触发删除确认的按钮：收尾归还焦点
const elConfirm = document.getElementById("confirmbar");
const elConfirmText = document.getElementById("confirmtext");
function askDelete(_kind, index, name) {
  cancelName(false);                           // 与命名互斥：避免两个内联控件同现 + 提交同名分组致索引漂移删错
  confirmOpener = document.activeElement;
  pendingDelete = { index };
  elConfirmText.textContent = t("con_delTpl", name);
  elConfirm.style.display = "";
  document.getElementById("confirm-no").focus(); // 默认落在「取消」，更安全
}
function closeConfirm(restoreFocus) {
  pendingDelete = null; elConfirm.style.display = "none";
  if (restoreFocus !== false && confirmOpener) { try { confirmOpener.focus(); } catch (e) {} }
  confirmOpener = null;
}
function cancelConfirm(restoreFocus) {
  closeConfirm(restoreFocus);
}
document.getElementById("confirm-yes").addEventListener("click", () => {
  if (!pendingDelete) return;
  templates = templates.filter((_, i) => i !== pendingDelete.index);
  chrome.storage.local.set({ amsTemplates: templates }); renderTemplates();
  closeConfirm();
});
document.getElementById("confirm-no").addEventListener("click", () => {
  cancelConfirm();
});
elConfirm.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); cancelConfirm(); } });
