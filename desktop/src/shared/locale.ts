export type DesktopLocale = "en" | "zhCN" | "zhTW";

// 全应用唯一的 locale 解析：外壳（copy.ts getCopy）与站点运行时（preload 注入 i18n.js setLang）都走这里。
// 前缀匹配，未命中任何 zh-* 分支一律 en，不兜底成 zhCN。
export function resolveLocale(rawLocale: string): DesktopLocale {
  const locale = rawLocale.toLowerCase();
  if (locale === "zh" || locale.startsWith("zh-cn") || locale.startsWith("zh-hans")) return "zhCN";
  if (
    locale.startsWith("zh-tw") ||
    locale.startsWith("zh-hk") ||
    locale.startsWith("zh-mo") ||
    locale.startsWith("zh-hant")
  ) return "zhTW";
  return "en";
}
