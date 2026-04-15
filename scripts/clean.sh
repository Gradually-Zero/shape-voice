#!/usr/bin/env bash
set -euo pipefail

# 1) 必须在 git 仓库里
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误：当前目录不在 Git 仓库中。"
  exit 1
fi

# 2) 建议只在仓库根目录执行，避免误删
repo_root="$(git rev-parse --show-toplevel)"
if [[ "$(pwd -P)" != "$(cd "$repo_root" && pwd -P)" ]]; then
  echo "请在仓库根目录执行：$repo_root"
  exit 1
fi

# # 3) 工作区必须“没有文件变更”（含未跟踪文件）
# if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
#   echo "检测到 Git 工作区有文件变更/未跟踪文件，已取消删除。"
#   git status --short
#   exit 1
# fi

# 3) 只检查工作区（不含暂存区）
# git diff --quiet: 检查已跟踪文件是否有“未暂存”改动
# git ls-files --others --exclude-standard: 检查未跟踪文件
if ! git diff --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "检测到工作区有文件（未暂存改动或未跟踪文件），已取消删除。"
  git status --short
  exit 1
fi

# 4) 工作区干净时，删除除 .git 外的所有内容
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf -- {} +
echo "删除完成：已保留 .git，其余内容已清理。"
