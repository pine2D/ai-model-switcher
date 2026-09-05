#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：bash scripts/release.sh [--build-only|--publish]

  --build-only  本地/CI 共用：校验源码、打包 Chrome ZIP、提取 Release notes、生成 SHA-256（默认）
  --publish     额外校验干净 main、origin/main 与 exact-HEAD CI，推 tag 后由 CI 构建全部 Desktop 包
EOF
}

MODE="build"
case "${1:---build-only}" in
  --build-only) ;;
  --publish) MODE="publish" ;;
  -h|--help) usage; exit 0 ;;
  *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
# 版本真源是 desktop/package.json；manifest.json 只是扩展退役前的跟随项（见下方 ZIP 内一致性校验）。
VERSION=$(node -p 'require("./desktop/package.json").version')
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "desktop/package.json 版本不是 X.Y.Z：$VERSION" >&2; exit 1; }
TAG="v$VERSION"
ZIP_NAME="polyask-${TAG}.zip"
DIST_DIR="${POLYASK_DIST_DIR:-dist}"
ZIP="$DIST_DIR/$ZIP_NAME"
NOTES="$DIST_DIR/release-notes.md"
CHECKSUM="$DIST_DIR/${ZIP_NAME}.sha256"
HEAD_SHA=$(git rev-parse HEAD)

if [ "${GITHUB_REF_TYPE:-}" = "tag" ] && [ "${GITHUB_REF_NAME:-}" != "$TAG" ]; then
  echo "tag ${GITHUB_REF_NAME} 与 desktop/package.json 的 $TAG 不一致" >&2
  exit 1
fi

preflight_publish() {
  [ -z "$(git status --porcelain --untracked-files=normal)" ] || { echo "发布要求工作区干净" >&2; exit 1; }
  [ "$(git branch --show-current)" = "main" ] || { echo "发布只允许 main 分支" >&2; exit 1; }
  [ "$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)" = "origin/main" ] || {
    echo "main 必须跟踪 origin/main" >&2; exit 1;
  }
  if ! command -v gh >/dev/null || ! gh auth status >/dev/null 2>&1; then
    echo "发布需要已登录的 gh CLI" >&2
    exit 1
  fi

  remote_refs=$(git ls-remote origin refs/heads/main) || { echo "无法读取 origin/main" >&2; exit 1; }
  remote_sha=$(awk '$2 == "refs/heads/main" {print $1; exit}' <<< "$remote_refs")
  [ "$remote_sha" = "$HEAD_SHA" ] || { echo "HEAD 尚未完整推送到 origin/main" >&2; exit 1; }

  repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
  ci=$(gh run list --repo "$repo" --workflow CI --commit "$HEAD_SHA" --limit 1 \
    --json headSha,status,conclusion,databaseId \
    --jq 'if length == 0 then "" else [.[0].headSha, .[0].status, (.[0].conclusion // ""), (.[0].databaseId | tostring)] | @tsv end')
  IFS=$'\t' read -r ci_sha ci_status ci_result ci_id <<< "$ci"
  if [ "${ci_sha:-}" != "$HEAD_SHA" ] || [ "${ci_status:-}" != "completed" ] || [ "${ci_result:-}" != "success" ]; then
    echo "exact-HEAD CI 未通过（run ${ci_id:-无}，${ci_status:-无}/${ci_result:-无}）" >&2
    exit 1
  fi

  git show-ref --verify --quiet "refs/tags/$TAG" && { echo "本地 tag $TAG 已存在；版本不可覆盖" >&2; exit 1; }
  remote_tags=$(git ls-remote origin "refs/tags/$TAG" "refs/tags/$TAG^{}") || { echo "无法检查远端 tag" >&2; exit 1; }
  [ -z "$remote_tags" ] || { echo "远端 tag $TAG 已存在；版本不可覆盖" >&2; exit 1; }
}

[ "$MODE" = "build" ] || preflight_publish

bash scripts/verify.sh
bash scripts/package.sh
mkdir -p "$DIST_DIR"
awk -v ver="$VERSION" '/^## \[/{flag = index($0, "[" ver "]") > 0; next} /^\[[^]]+\]: /{flag=0} flag' \
  CHANGELOG.md > "$NOTES"
grep -q '^- ' "$NOTES" || { echo "CHANGELOG.md 缺少 [$VERSION] 的有效版本条目" >&2; exit 1; }
grep -Eq "^\[未发布\]: .*/compare/$TAG\.\.\.HEAD$" CHANGELOG.md || {
  echo "CHANGELOG.md 的 [未发布] 链接未从 $TAG 开始" >&2; exit 1;
}
grep -Eq "^\[$VERSION\]: .*/(compare/.*\.\.\.$TAG|releases/tag/$TAG)$" CHANGELOG.md || {
  echo "CHANGELOG.md 缺少 [$VERSION] 版本链接" >&2; exit 1;
}
# F191_UNRELEASED_GUARD_START
# 只在 --publish 拦：临发版补写进 [未发布] 段的条目会被下次 prepare-release.sh 整体错记到下一版号，
# 且不会出现在本次 Release 说明里。--build-only 同时被 ci.yml/release.yml 的普通 CI 步骤调用，
# 「未发布段非空」是那里的常态，一律拦会把日常 PR/CI 变红。
if [ "$MODE" = "publish" ]; then
  UNRELEASED=$(awk '/^## \[未发布\]/{flag=1; next} /^## \[/{flag=0} flag' CHANGELOG.md)
  ! grep -q '^- ' <<< "$UNRELEASED" || {
    echo "CHANGELOG.md 的 [未发布] 段仍有未晋升条目；发版前应先跑 prepare-release.sh 晋升，不要临发版补写" >&2
    exit 1
  }
fi
# F191_UNRELEASED_GUARD_END
packaged_version=$(unzip -p "$ZIP" manifest.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).version))')
[ "$packaged_version" = "$VERSION" ] || { echo "ZIP 内 manifest 版本 $packaged_version 与 desktop/package.json 的 $VERSION 不一致（扩展退役前 manifest 是跟随项）" >&2; exit 1; }
(cd "$DIST_DIR" && sha256sum "$ZIP_NAME" > "${ZIP_NAME}.sha256")

echo "✓ $TAG 构建通过：$ZIP"
echo "✓ Release notes：$NOTES"
echo "✓ SHA-256：$CHECKSUM"

if [ "$MODE" = "publish" ]; then
  if [ "$HEAD_SHA" != "$(git rev-parse HEAD)" ] || [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo "构建期间源码发生变化，请重新发布" >&2
    exit 1
  fi
  remote_refs=$(git ls-remote origin refs/heads/main) || { echo "无法重新检查 origin/main" >&2; exit 1; }
  remote_sha=$(awk '$2 == "refs/heads/main" {print $1; exit}' <<< "$remote_refs")
  [ "$remote_sha" = "$HEAD_SHA" ] || { echo "构建期间 origin/main 已变化，请重新发布" >&2; exit 1; }
  git tag "$TAG"
  if ! git push origin "$TAG"; then
    echo "tag 推送失败；本地 $TAG 保留，请查明后重试 git push origin $TAG" >&2
    exit 1
  fi
  echo "✓ 已推送 $TAG；GitHub Release workflow 将发布 Chrome ZIP、五个 Desktop 预览包、校验和与 CHANGELOG 说明。"
fi
