// OPTIONS_ROUTE_START
const OPTION_SECTIONS = ["general", "sync", "transfer", "privacy"];
function optionSection(hash) {
  const value = String(hash || "").replace(/^#/, "");
  return OPTION_SECTIONS.includes(value) ? value : "general";
}
// OPTIONS_ROUTE_END

function renderSection() {
  const active = optionSection(location.hash);
  document.querySelectorAll("[data-options-section]").forEach((section) => {
    section.hidden = section.id !== `section-${active}`;
  });
  document.querySelectorAll("[data-options-nav]").forEach((link) => {
    if (link.hash === `#${active}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (location.hash !== `#${active}`) history.replaceState(null, "", `#${active}`);
}
window.addEventListener("hashchange", renderSection);
renderSection();

const PREFS = {
  theme: { key: "amsTheme", fallback: "auto" },
  language: { key: "amsLang", fallback: "auto" },
  "display-mode": { key: "displayMode", fallback: "handle" },
  "auto-raise": { key: "amsAutoRaise", fallback: true },
};

function renderPref(control, pref, value) {
  value = value === undefined ? pref.fallback : value;
  if (control.type === "checkbox") control.checked = value !== false;
  else control.value = value;
}

for (const [id, pref] of Object.entries(PREFS)) {
  const control = document.getElementById(id);
  chrome.storage.local.get({ [pref.key]: pref.fallback }, (value) => {
    renderPref(control, pref, value[pref.key]);
  });
  control.addEventListener("change", () => {
    chrome.storage.local.set({ [pref.key]: control.type === "checkbox" ? control.checked : control.value });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [id, pref] of Object.entries(PREFS)) {
    if (changes[pref.key]) renderPref(document.getElementById(id), pref, changes[pref.key].newValue);
  }
});
