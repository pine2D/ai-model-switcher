#!/usr/bin/env bash
# 把 PolyAsk 打包成可上传 Chrome Web Store / 加载的 zip。
# 只含运行时文件，排除文档与开发产物。版本号取自 manifest.json。
# 用法：bash scripts/package.sh   →   产出 dist/polyask-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."   # 仓库根

command -v zip >/dev/null || { echo "需要 zip 命令（Debian/Ubuntu: sudo apt install zip）" >&2; exit 1; }

# 从 manifest.json 提取版本号（无需 node）
VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
[ -n "$VERSION" ] || { echo "无法从 manifest.json 解析版本号" >&2; exit 1; }

DIST_DIR="${POLYASK_DIST_DIR:-dist}"
OUT="${DIST_DIR}/polyask-v${VERSION}.zip"
RUNTIME=(manifest.json _locales i18n.js background.js bg icons content console popup options)

# 运行时文件齐全性校验（缺一即扩展静默不工作）
for p in "${RUNTIME[@]}"; do
  [ -e "$p" ] || { echo "缺少运行时文件: $p" >&2; exit 1; }
done

mkdir -p "$DIST_DIR"
rm -f "$OUT"
# 排除任何隐藏文件 / .DS_Store / 临时备份
zip -r -q "$OUT" "${RUNTIME[@]}" -x '*/.*' -x '*.DS_Store' -x '*~'

# —— 产物对账：manifest/HTML/importScripts 引用的每个文件必须真的在 zip 里 ——
# v0.5.0/v0.6.0 坏包事故根因：RUNTIME 白名单漏项只在干净机器装 zip 时才暴露；这里让它在打包时就炸。
ENTRIES=$(zip -sf "$OUT" | sed 's/^ *//')
refs() {
  # manifest 里所有带扩展名的文件路径（icons/popup/background/content js）
  grep -oE '"[A-Za-z0-9_][A-Za-z0-9_/.-]*\.(js|html|png|css|json)"' manifest.json | tr -d '"'
  # default_locale 对应的 messages.json
  echo "_locales/$(grep -m1 '"default_locale"' manifest.json | sed -E 's/.*"default_locale"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')/messages.json"
  # SW 的 importScripts 依赖（路径相对扩展根）
  grep -oE 'importScripts\([^)]*\)' background.js | grep -oE '"[^"]+"' | tr -d '"'
  # 包内每个 HTML 的 src/href 相对引用，折算成包内路径
  for h in $(echo "$ENTRIES" | grep '\.html$'); do
    grep -oE '(src|href)="[^"]+"' "$h" | sed -E 's/^(src|href)="//; s/"$//' | while read -r r; do
      case "$r" in http*|data:*|\#*) ;; *) realpath -m --relative-to=. "$(dirname "$h")/$r" ;; esac
    done
  done
}
MISS=$(refs | sort -u | while read -r p; do echo "$ENTRIES" | grep -qx "$p" || echo "$p"; done)
[ -z "$MISS" ] || {
  echo "✗ zip 缺少运行时引用的文件（RUNTIME 白名单漏项？）：" >&2
  while IFS= read -r missing; do echo "    $missing" >&2; done <<< "$MISS"
  rm -f "$OUT"
  exit 1
}

echo "✓ 打包完成: $OUT ($(du -h "$OUT" | cut -f1))，产物对账通过"
echo "包含条目："
zip -sf "$OUT" | sed '1d;$d' | sed 's/^/  /'
