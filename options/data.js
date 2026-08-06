// options/data.js — 本机数据清理的共享二段确认。
const localDataButtons = [...document.querySelectorAll("[data-local-data-action]")];
const localDataConfirmation = document.getElementById("local-data-confirmation");
const localDataWarning = document.getElementById("local-data-warning");
const localDataContinue = document.getElementById("local-data-continue");
const localDataStatus = document.getElementById("local-data-status");
const localDataCopy = {
  clearHistory: ["localData_historyWarning", "localData_clearHistory", "localData_historyDone"],
  clearArchives: ["localData_archivesWarning", "localData_clearArchives", "localData_archivesDone"],
  resetLocal: ["localData_resetWarning", "localData_reset", "localData_resetDone"],
};
let localDataAction = null, localDataBusy = false;
function renderLocalDataConfirmation() {
  localDataConfirmation.hidden = !localDataAction;
  if (!localDataAction) return;
  const copy = localDataCopy[localDataAction];
  localDataWarning.textContent = t(copy[0]); localDataContinue.textContent = t(copy[1]);
}
function setLocalDataBusy(value) {
  localDataBusy = value; localDataButtons.forEach((button) => { button.disabled = value; });
  localDataContinue.disabled = value; document.getElementById("local-data-cancel").disabled = value;
}
for (const button of localDataButtons) button.addEventListener("click", () => {
  if (localDataBusy) return;
  localDataAction = button.dataset.localDataAction; localDataStatus.textContent = "";
  renderLocalDataConfirmation(); localDataContinue.focus();
});
document.getElementById("local-data-cancel").addEventListener("click", () => {
  if (localDataBusy) return; localDataAction = null; renderLocalDataConfirmation();
});
localDataContinue.addEventListener("click", async () => {
  const action = localDataAction; if (!action || localDataBusy) return;
  setLocalDataBusy(true);
  try {
    const result = await chrome.runtime.sendMessage({ source: "AMS_DATA_ADMIN", action });
    if (!result?.ok) throw new Error(result?.code || "local_data_failed");
    localDataStatus.textContent = action === "resetLocal" ? t(localDataCopy[action][2]) : t(localDataCopy[action][2], result.count || 0);
    localDataAction = null; renderLocalDataConfirmation();
  } catch (_) { localDataStatus.textContent = t("localData_failed"); }
  finally { setLocalDataBusy(false); }
});
document.addEventListener("i18n:changed", renderLocalDataConfirmation);
