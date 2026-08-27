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
mapfile -t DOC_REFS < <(grep -ohE 'docs/[A-Za-z0-9._-]+\.md' CLAUDE.md README.md docs/*.md | sort -u)
[ "${#DOC_REFS[@]}" -gt 0 ] || { echo "✗ 未提取到任何 docs/*.md 引用，检查本身已失效" >&2; exit 1; }
for doc in "${DOC_REFS[@]}"; do
  [ -s "$doc" ] || { echo "✗ 文档引用失效或为空: $doc" >&2; exit 1; }
done

echo "[docs] 检查 .github 引用未失效"
mapfile -t GH_REFS < <(grep -ohE '\.github/[A-Za-z0-9._/-]+\.ya?ml' CLAUDE.md README.md docs/*.md 2>/dev/null | sort -u)
for ref in "${GH_REFS[@]}"; do
  [ -s "$ref" ] || { echo "✗ 文档引用的 .github 文件失效或为空: $ref" >&2; exit 1; }
done

echo "[docs] 检查 test-*.js 均已登记"
for file in scripts/test-*.js; do
  grep -qxF "node $file" scripts/verify.sh && continue   # 整行匹配：注释掉的登记行不算数
  grep -qF "verify-skip: $file " scripts/verify.sh && continue
  echo "✗ $file 未被 verify.sh 调用；登记进下方清单，或加一行注释 '# verify-skip: $file <理由>'" >&2
  exit 1
done
# verify-skip: scripts/test-sync-engine.js 是被 test-sync-runtime.js require 的用例模块，直接 node 跑只定义不执行

echo "[test] 用户可见文案与本地化"
node scripts/test-content-l10n.js
node scripts/test-err-codes.js
node scripts/test-release-flow.js
node scripts/test-oauth-secret-hygiene.js

echo "[test] 后台安全边界与控制台交互"
node scripts/test-page-context.js
node scripts/test-page-context-order.js
node scripts/test-run-meta.js
node scripts/test-compose-context.js
node scripts/test-compose-handoff.js
node scripts/test-console-prompt.js
node scripts/test-site-selection.js
node scripts/test-background.js
node scripts/test-tile-reflow.js
node scripts/test-console-ready.js
node scripts/test-archive-capture.js
node scripts/test-archive-detail.js
node scripts/test-archive-library-ui.js
node scripts/test-console-polish.js
node scripts/test-icon-system.js

echo "[test] 站点模型适配"
node scripts/test-desktop-shared-runtime.js
node scripts/test-intl-runtime.js
node scripts/test-claude-model.js
node scripts/test-qwen-adapter.js
node scripts/test-site-send-runtime.js
node scripts/test-submit-recovery.js
node scripts/test-diag-runtime.js
node scripts/test-probe-drift.js

echo "[test] 图片载荷与群发消息契约"
node scripts/test-synthesis-model.js
node scripts/test-synthesis-runtime.js
node scripts/test-synthesis-ui.js
node scripts/test-archive-synthesis.js
node scripts/test-image.js
node scripts/test-image-runtime.js
node scripts/test-multi-image.js
node scripts/test-transfer.js

echo "[test] Google Drive 同步"
node scripts/test-archive-model.js
node scripts/test-archive-data.js
node scripts/test-sync-model.js
node scripts/test-sync-runtime.js
node scripts/test-sync-ui.js
node scripts/test-sync-feedback.js
node scripts/test-sync-integrity.js
node scripts/test-sync-scale.js
node scripts/test-data-controls.js
node scripts/test-data-controls-ui.js
node scripts/test-options-ui.js

git diff --check
echo "[verify] 全部通过"
