#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：bash scripts/prepare-release.sh <auto|patch|minor|major|X.Y.Z> [--dry-run]

把 CHANGELOG.md 的「未发布」晋升为新版本，并同步 Desktop package/lock 与底部比较链接。
只改文件，不 commit、不打 tag；auto 按上次版本后的 Conventional Commits 取最高级别。
EOF
}

SPEC=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    auto|patch|minor|major|[0-9]*.[0-9]*.[0-9]*)
      [ -z "$SPEC" ] || { echo "只能指定一个版本策略" >&2; exit 2; }
      SPEC="$arg"
      ;;
    *) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
  esac
done
[ -n "$SPEC" ] || { usage >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
command -v python3 >/dev/null || { echo "需要 python3" >&2; exit 1; }

python3 - "CHANGELOG.md" "desktop/package.json" "desktop/package-lock.json" "$SPEC" "$(date +%F)" "$DRY_RUN" <<'PY'
import json
import re
import subprocess
import sys
from pathlib import Path

changelog_path, desktop_path, desktop_lock_path, spec, today, dry = sys.argv[1:]
dry = dry == "1"
changelog_file = Path(changelog_path)
desktop_file = Path(desktop_path)
desktop_lock_file = Path(desktop_lock_path)
desktop = json.loads(desktop_file.read_text(encoding="utf-8"))
desktop_lock = json.loads(desktop_lock_file.read_text(encoding="utf-8"))
# 版本真源是 desktop/package.json；desktop/package-lock.json 是跟随项。
current = desktop.get("version", "")

def parse(value, label):
    if not re.fullmatch(r"\d+\.\d+\.\d+", value):
        raise SystemExit(f"错误：{label} 不是 X.Y.Z：{value}")
    return tuple(map(int, value.split(".")))

current_parts = parse(current, "desktop/package.json 版本")
if desktop_lock.get("version") != current or desktop_lock.get("packages", {}).get("", {}).get("version") != current:
    raise SystemExit("错误：desktop/package-lock.json 根版本与 desktop/package.json 不一致")

if spec == "auto":
    result = subprocess.run(
        ["git", "log", f"v{current}..HEAD", "--format=%B%x1e", "--no-merges"],
        capture_output=True, text=True,
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or f"错误：无法读取 v{current}..HEAD")
    rank = {"": 0, "patch": 1, "minor": 2, "major": 3}
    bump = ""
    for message in filter(None, (part.strip() for part in result.stdout.split("\x1e"))):
        subject = message.splitlines()[0]
        if re.search(r"(^|\n)BREAKING(?: CHANGE|-CHANGE):", message) or re.match(r"^\w+(?:\([^)]+\))?!:", subject):
            candidate = "major"
        elif re.match(r"^feat(?:\([^)]+\))?:", subject):
            candidate = "minor"
        elif re.match(r"^(?:fix|perf|refactor)(?:\([^)]+\))?:", subject):
            candidate = "patch"
        else:
            continue
        if rank[candidate] > rank[bump]:
            bump = candidate
    if not bump:
        raise SystemExit("错误：上个版本后没有需要升版的 Conventional Commit")
    spec = bump

if spec in {"patch", "minor", "major"}:
    major, minor, patch = current_parts
    if spec == "major":
        target = f"{major + 1}.0.0"
    elif spec == "minor":
        target = f"{major}.{minor + 1}.0"
    else:
        target = f"{major}.{minor}.{patch + 1}"
else:
    target = spec

target_parts = parse(target, "目标版本")
if target_parts <= current_parts:
    raise SystemExit(f"错误：目标版本 {target} 必须高于 {current}")

changelog = changelog_file.read_text(encoding="utf-8")
if re.search(rf"^## \[{re.escape(target)}\](?:\s|$)", changelog, re.M):
    raise SystemExit(f"错误：CHANGELOG.md 已存在 [{target}] 段落")

unreleased = re.search(r"^## \[未发布\]\s*$", changelog, re.M)
if not unreleased:
    raise SystemExit("错误：CHANGELOG.md 缺少 [未发布] 段落")
next_header = re.search(r"^## \[[^]]+\].*$", changelog[unreleased.end():], re.M)
if not next_header:
    raise SystemExit("错误：[未发布] 后没有既有版本段落")
section_end = unreleased.end() + next_header.start()
body = changelog[unreleased.end():section_end].strip()
if not body or not re.search(r"^### ", body, re.M) or not re.search(r"^- ", body, re.M):
    raise SystemExit("错误：[未发布] 为空；先写面向用户的分类条目")

prefix = changelog[:unreleased.start()]
rest = changelog[section_end:].lstrip("\n")
updated_changelog = f"{prefix}## [未发布]\n\n## [{target}] - {today}\n\n{body}\n\n{rest}"

link = re.compile(
    rf"^\[未发布\]: (?P<base>https://github\.com/[^\s]+/compare/)v{re.escape(current)}\.\.\.HEAD\s*$",
    re.M,
)
match = link.search(updated_changelog)
if not match:
    raise SystemExit(f"错误：[未发布] 比较链接不是从 v{current} 开始")
base = match.group("base")
updated_changelog = link.sub(
    f"[未发布]: {base}v{target}...HEAD\n[{target}]: {base}v{current}...v{target}",
    updated_changelog,
    count=1,
)

print(f"准备：v{current} → v{target}（{spec}）")
if dry:
    print("dry-run：文件未修改")
else:
    changelog_file.write_text(updated_changelog, encoding="utf-8")
    desktop["version"] = target
    desktop_lock["version"] = target
    desktop_lock["packages"][""]["version"] = target
    desktop_file.write_text(json.dumps(desktop, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    desktop_lock_file.write_text(json.dumps(desktop_lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("已更新 Desktop 与 CHANGELOG.md；请审阅后提交。")
PY
