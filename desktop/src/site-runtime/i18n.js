// desktop/src/site-runtime/i18n.js — 站点运行时（同目录 *.js）的三语词条。同步字典；语言由 Desktop 外壳在 preload 里通过
// __AMS_I18N__.setLang(resolveLocale(navigator.language)) 单向注入，本文件不再自己解析 locale、不读任何存储。
// 词条只保留同目录 *.js 里真有 t("…") 调用的键（含 core.js runMode 三元取的 cs_switchedThink/cs_switchedFast）；
// 派生规则与「死词条必须红」的反向断言见 scripts/test-desktop-shared-runtime.js。
const MSG = {
  cs_diagError:      { en: "Diagnostic error",                                  zh_CN: "诊断异常",                        zh_TW: "診斷錯誤" },
  cs_siteAdapter:    { en: "Site adapter",                                      zh_CN: "站点适配器",                      zh_TW: "網站適配器" },
  cs_stopped:        { en: "Stopped",                                           zh_CN: "已停止",                          zh_TW: "已停止" },
  cs_switchFailGeneric: { en: "Switch failed",                                  zh_CN: "切换失败",                        zh_TW: "切換失敗" },
  cs_switchUnstable:      { en: "Switch not confirmed; sent using the current tier", zh_CN: "切换未确认，已按当前档位发送", zh_TW: "切換未確認，已依目前檔位傳送" },
  cs_switchedThink:  { en: "Switched: Deep Think",                              zh_CN: "已切到：深度思考",                zh_TW: "已切到：深度思考" },
  cs_switchedFast:   { en: "Switched: Fast Model",                              zh_CN: "已切到：快速模型",                zh_TW: "已切到：快速模型" },
  diag_composer:     { en: "Composer",                                          zh_CN: "输入框",                          zh_TW: "輸入框" },
  diag_deepThink:    { en: "DeepThink toggle",                                  zh_CN: "DeepThink 开关",                  zh_TW: "DeepThink 開關" },
  diag_intelEntry:   { en: "Intelligence entry",                                zh_CN: "Intelligence 入口",               zh_TW: "Intelligence 入口" },
  diag_modeBtn:      { en: "Mode button",                                       zh_CN: "模式按钮",                        zh_TW: "模式按鈕" },
  diag_modelDropdown:{ en: "Model dropdown",                                    zh_CN: "模型下拉",                        zh_TW: "模型下拉" },
  diag_modelEntry:   { en: "Model entry",                                       zh_CN: "模型入口",                        zh_TW: "模型入口" },
  diag_modelReadable:{ en: "Model detected",                                    zh_CN: "已识别模型",                      zh_TW: "已辨識模型" },
  diag_sendKey:      { en: "Send button",                                       zh_CN: "发送键",                          zh_TW: "發送鍵" },
  diag_thinkBtn:     { en: "Thinking toggle",                                   zh_CN: "思考开关",                        zh_TW: "思考開關" },
  diag_thinkButton:  { en: "Thinking button",                                   zh_CN: "思考按钮",                        zh_TW: "思考按鈕" },
  diag_tierReadable: { en: "Tier detected",                                     zh_CN: "已识别档位",                      zh_TW: "已辨識檔位" },
  md_image:          { en: "image",                                            zh_CN: "图片",                            zh_TW: "圖片" }
};
const I18N_LANGS = ["en", "zh_CN", "zh_TW"];
let _lang = "en";
// 接受本文件自己的 zh_CN / zh_TW，也接受 desktop/src/shared/locale.ts 的 zhCN / zhTW；其余一律 en。
function setLang(lang) {
  const normalized = String(lang || "").replace(/^zh(CN|TW)$/, "zh_$1");
  _lang = I18N_LANGS.includes(normalized) ? normalized : "en";
}
function t(key, ...subs) {
  const row = MSG[key];
  let s = (row && (row[_lang] || row.en)) || key;
  subs.forEach((v, i) => { s = s.split("{" + i + "}").join(String(v)); });
  return s;
}
// Desktop preload 把 classic scripts 分别打包成模块；显式命名空间避免依赖跨脚本词法作用域。
globalThis.__AMS_I18N__ = Object.freeze({ t, setLang });
