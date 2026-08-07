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

echo "[test] 用户可见文案与本地化"
node scripts/test-content-l10n.js

echo "[test] 后台安全边界与控制台交互"
node scripts/test-page-context.js
node scripts/test-page-context-order.js
node scripts/test-run-meta.js
node scripts/test-compose-context.js
node scripts/test-compose-handoff.js
node scripts/test-console-prompt.js
node scripts/test-site-selection.js
node scripts/test-background.js
node scripts/test-console-ready.js
node scripts/test-archive-capture.js
node scripts/test-archive-detail.js
node scripts/test-archive-library-ui.js
node scripts/test-console-polish.js
node scripts/test-icon-system.js

echo "[test] 站点模型适配"
node scripts/test-intl-runtime.js
node scripts/test-claude-model.js
node scripts/test-qwen-adapter.js
node scripts/test-site-send-runtime.js
node scripts/test-submit-recovery.js

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
