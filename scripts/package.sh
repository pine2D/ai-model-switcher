#!/usr/bin/env bash
# 把 PolyAsk 打包成可上传 Chrome Web Store / 加载的 zip。
# 只含运行时文件，排除文档与开发产物。版本号取自 manifest.json。
# 用法：bash scripts/package.sh   →   产出 dist/polyask-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."   # 仓库根

command -v zip >/dev/null || { echo "需要 zip 命令（Debian/Ubuntu: sudo apt install zip）" >&2; exit 1; }
command -v git >/dev/null || { echo "需要 git 命令（可复现构建靠它取提交时间）" >&2; exit 1; }

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
case "$OUT" in
  /*) OUT_ABS="$OUT" ;;
  *) OUT_ABS="$(pwd)/$OUT" ;;
esac

# 可复现构建：条目 mtime 固定为 HEAD 提交时间、时区固定 UTC、不带 UID/GID 与额外属性（-X），
# 同一提交在任意机器/任意 clone 上打出字节相同的 zip。必须在临时 stage 目录里改 mtime——
# 直接 touch 工作区文件会污染开发机的增量工具状态（scripts/release.sh 的发布前置会检查
# git status --porcelain 干净），且与 CI 的 fresh checkout 行为分叉。仅依赖 GNU coreutils（`touch -d @epoch`），
# 与本仓其余脚本一致假设 Linux/CI 环境（WSL2 开发机、ubuntu-latest CI）。
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
for p in "${RUNTIME[@]}"; do
  cp -r "$p" "$STAGE/$p"
done
find "$STAGE" -exec touch -d "@$SOURCE_DATE_EPOCH" {} +
# 排除任何隐藏文件 / .DS_Store / 临时备份
( cd "$STAGE" && TZ=UTC zip -rXq "$OUT_ABS" "${RUNTIME[@]}" -x '*/.*' -x '*.DS_Store' -x '*~' )

# —— 产物对账：manifest/HTML/CSS/importScripts 引用的每个文件必须真的在 zip 里 ——
# v0.5.0/v0.6.0 坏包事故根因：RUNTIME 白名单漏项只在干净机器装 zip 时才暴露；这里让它在打包时就炸。
ENTRIES=$(zip -sf "$OUT" | sed 's/^ *//')

manifest_refs() {
  # manifest 里所有带扩展名的文件路径（icons/popup/background/content js）；`|| true` 见下方 sw_refs 的注释。
  grep -oE '"[A-Za-z0-9_][A-Za-z0-9_/.-]*\.(js|html|png|css|json)"' manifest.json | tr -d '"' || true
  # default_locale 对应的 messages.json
  echo "_locales/$(grep -m1 '"default_locale"' manifest.json | sed -E 's/.*"default_locale"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')/messages.json"
}
sw_refs() {
  # SW 的 importScripts 依赖（路径相对扩展根）；importScripts(...) 调用可能跨行折行，
  # 先把整份文件拼成一行再抽，否则跨行调用里 `[^)]*` 抽不到右括号，静默归零。
  # 管道末尾 `|| true`：grep 抽到 0 条时退出 1，pipefail 下会让这次 `$(sw_refs)` 赋值在 set -e 下
  # 直接静默中断整个脚本（无回显、只剩裸 exit 1）——必须让"抽到 0 条"这个信号活着传到下面的
  # `[ -n "$sw_out" ]` 自检，由它打出诊断信息，而不是被 errexit 抢先吞掉。
  tr '\n' ' ' < background.js | grep -oE 'importScripts\([^)]*\)' | grep -oE '"[^"]+"' | tr -d '"' || true
}
html_refs() {
  # 包内每个 HTML 的 src/href 相对引用，折算成包内路径。管道末尾 `|| true`：某个文件恰好零匹配时
  # grep 退出 1，pipefail 下会让该次迭代（进而整个函数、进而下面的 `$(...)` 赋值）在 set -e 下整体
  # 中断——这不是"检查失效"，是"这份文件没有这类引用"，两者必须分开，不能靠 errexit 代劳。
  for h in $(echo "$ENTRIES" | grep '\.html$'); do
    grep -oE '(src|href)="[^"]+"' "$h" | sed -E 's/^(src|href)="//; s/"$//' | while read -r r; do
      case "$r" in http*|data:*|\#*) ;; *) realpath -m --relative-to=. "$(dirname "$h")/$r" ;; esac
    done || true
  done
}
css_refs() {
  # 包内每个 CSS 的 url() 相对引用（图标 mask-image 一类），折算成包内路径；`|| true` 理由同 html_refs——
  # 当前 4 份 CSS 里 archive.css / options.css 本来就没有 url()，零匹配不代表检查坏了。
  for c in $(echo "$ENTRIES" | grep '\.css$'); do
    grep -oE 'url\("[^"]+"\)' "$c" | sed -E 's/^url\("//; s/"\)$//' | while read -r r; do
      case "$r" in http*|data:*|\#*) ;; *) realpath -m --relative-to=. "$(dirname "$c")/$r" ;; esac
    done || true
  done
}

# 四路各自的产物先存到变量里，逐一断言非空（实测：`VAR=$(pipeline)` 里只要 pipeline 最终返回非零，
# set -e 会在赋值处直接杀掉整个脚本且不打印任何东西——这正是上面每个 refs 函数都要 `|| true` 吞掉
# "零匹配"这个正常退出码的原因；`|| true` 之后函数必定返回 0，"抽到 0 条"这个信号才能活着传到这里，
# 由下面的自检打出诊断信息并显式 exit 1，而不是被 errexit 抢先无声吞掉）。
manifest_out=$(manifest_refs)
sw_out=$(sw_refs)
html_out=$(html_refs)
css_out=$(css_refs)

[ -n "$manifest_out" ] || { echo "✗ manifest 引用抽取到 0 条，检查本身已失效" >&2; exit 1; }
[ -n "$sw_out" ] || { echo "✗ importScripts 引用抽取到 0 条，检查本身已失效" >&2; exit 1; }
[ -n "$html_out" ] || { echo "✗ HTML src/href 引用抽取到 0 条，检查本身已失效" >&2; exit 1; }
[ -n "$css_out" ] || { echo "✗ CSS url() 引用抽取到 0 条，检查本身已失效" >&2; exit 1; }

MISS=$(printf '%s\n%s\n%s\n%s\n' "$manifest_out" "$sw_out" "$html_out" "$css_out" | sort -u | while read -r p; do
  [ -n "$p" ] || continue
  echo "$ENTRIES" | grep -qx "$p" || echo "$p"
done)
[ -z "$MISS" ] || {
  echo "✗ zip 缺少运行时引用的文件（RUNTIME 白名单漏项？）：" >&2
  while IFS= read -r missing; do echo "    $missing" >&2; done <<< "$MISS"
  rm -f "$OUT"
  exit 1
}

echo "✓ 打包完成: $OUT ($(du -h "$OUT" | cut -f1))，产物对账通过"
echo "包含条目："
zip -sf "$OUT" | sed '1d;$d' | sed 's/^/  /'
