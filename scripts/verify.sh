#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

existing_files() {
  git ls-files -z --cached --others --exclude-standard -- "$1" |
    while IFS= read -r -d '' file; do
      [ -f "$file" ] && printf '%s\0' "$file"
    done
}

echo "[syntax] 检查 JavaScript"
mapfile -d '' -t JS_FILES < <(existing_files '*.js')
for file in "${JS_FILES[@]}"; do
  node --check "$file"
done
mapfile -d '' -t MJS_FILES < <(existing_files '*.mjs')
for file in "${MJS_FILES[@]}"; do
  node --check "$file"
done

echo "[json] 检查 JSON"
mapfile -d '' -t JSON_FILES < <(existing_files '*.json')
for file in "${JSON_FILES[@]}"; do
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$file"
done

echo "[size] 检查 JS 单文件不超过 300 行"
for file in "${JS_FILES[@]}"; do
  lines=$(wc -l < "$file")
  [ "$lines" -le 300 ] || { echo "✗ $file: $lines 行" >&2; exit 1; }
done

echo "[security] 检查 Desktop OAuth 凭据卫生"
OAUTH_RESOURCE='desktop/resources/oauth.json'
git check-ignore --quiet --no-index -- "$OAUTH_RESOURCE" || {
  echo "✗ $OAUTH_RESOURCE 必须保持 Git 忽略" >&2
  exit 1
}
if git ls-files --error-unmatch -- "$OAUTH_RESOURCE" >/dev/null 2>&1; then
  echo "✗ $OAUTH_RESOURCE 不得进入版本控制" >&2
  exit 1
fi
mapfile -d '' -t VERSIONED_FILES < <(existing_files '*')
node scripts/oauth-secret-hygiene.js "${VERSIONED_FILES[@]}"

echo "[docs] 检查文档引用未失效"
# 来源与判据都只认 Git 视角：docs/*.md 用 `git ls-files`（不含未入库的本地工作文档，如
# docs/audit-2026-07.md 白名单外那些一次性排查稿），判据用 `git ls-files --error-unmatch`
# 而非 `[ -s ]`——本机若在工作区留着一份未 `git add` 的同名文件，`[ -s ]` 会本机误判通过，
# 而 CI 走干净 checkout 看不到它，会在一个本机复现不出的失败上卡住发版（release.sh 的
# preflight_publish 硬要求 exact-HEAD CI 成功）。CHANGELOG.md 纳入来源：它的历史条目里也会
# 引用 docs/*.md（如「本版源自一次全仓审查」），同样不该允许悬空。
mapfile -t DOC_SOURCES < <(git ls-files -- 'docs/*.md'; printf '%s\n' CLAUDE.md README.md CHANGELOG.md)
mapfile -t DOC_REFS < <(grep -ohE 'docs/[A-Za-z0-9._-]+\.md' "${DOC_SOURCES[@]}" | sort -u)
[ "${#DOC_REFS[@]}" -gt 0 ] || { echo "✗ 未提取到任何 docs/*.md 引用，检查本身已失效" >&2; exit 1; }
for doc in "${DOC_REFS[@]}"; do
  [ -s "$doc" ] || { echo "✗ 文档引用失效或为空: $doc" >&2; exit 1; }
  git ls-files --error-unmatch -- "$doc" >/dev/null 2>&1 || {
    echo "✗ 文档引用的文件未被 Git 跟踪: $doc（本机存在同名文件但未 git add，或需要在 .gitignore 里补一行 !$doc）" >&2
    exit 1
  }
done

echo "[docs] 检查 .github 引用未失效"
mapfile -t GH_REFS < <(grep -ohE '\.github/[A-Za-z0-9._/-]+\.ya?ml' CLAUDE.md README.md docs/*.md 2>/dev/null | sort -u)
for ref in "${GH_REFS[@]}"; do
  [ -s "$ref" ] || { echo "✗ 文档引用的 .github 文件失效或为空: $ref" >&2; exit 1; }
done

echo "[lint] 检查 workflow YAML 可解析"
# YAML 错误只能在推 tag 后由 GitHub 暴露，而 tag 不可覆盖 = 烧掉一个版本号；离线先解析一遍。
# 优先 actionlint（连 schema 都查，如 runs-on 拼错、needs 指向不存在的 job）；没装则退化到
# 仅查语法的 PyYAML；两者都没有就打印警告跳过——环境缺依赖不该把无关改动的 verify 变红。
mapfile -d '' -t WORKFLOW_FILES < <(existing_files '.github/workflows/*.yml')
if command -v actionlint >/dev/null 2>&1; then
  actionlint "${WORKFLOW_FILES[@]}"
elif python3 -c 'import yaml' >/dev/null 2>&1; then
  for wf in "${WORKFLOW_FILES[@]}"; do
    python3 -c 'import sys, yaml; yaml.safe_load(open(sys.argv[1], encoding="utf-8"))' "$wf"
  done
else
  echo "⚠ 未找到 actionlint，也没有 Python PyYAML，跳过 workflow YAML 解析检查" >&2
fi

echo "[docs] 检查 test-*.js 均已登记"
for file in scripts/test-*.js; do
  grep -qxF "node $file" scripts/verify.sh && continue   # 整行匹配：注释掉的登记行不算数
  grep -qF "verify-skip: $file " scripts/verify.sh && continue
  echo "✗ $file 未被 verify.sh 调用；登记进下方清单，或加一行注释 '# verify-skip: $file <理由>'" >&2
  exit 1
done

echo "[test] 用户可见文案与本地化"
node scripts/test-content-l10n.js
node scripts/test-release-flow.js
node scripts/test-release-feed.js
node scripts/test-oauth-secret-hygiene.js

echo "[test] 站点登记与跨端契约"
node scripts/test-site-selection.js

echo "[test] 站点模型适配"
node scripts/test-desktop-shared-runtime.js
node scripts/test-intl-runtime.js
node scripts/test-send-runtime.js
node scripts/test-intl2-runtime.js
node scripts/test-claude-model.js
node scripts/test-qwen-adapter.js
node scripts/test-site-send-runtime.js
node scripts/test-cn-tier-runtime.js
node scripts/test-diag-runtime.js
node scripts/test-generation-runtime.js

echo "[test] 图片载荷与 Markdown"
node scripts/test-image-limits.js
node scripts/test-image-runtime.js
node scripts/test-md-runtime.js

git diff --check
echo "[verify] 全部通过"
