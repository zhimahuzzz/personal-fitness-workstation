#!/usr/bin/env bash
# 老张健身工作台 · 一键部署脚本（Git Bash / macOS / Linux 通用）
# 用法：
#   export GITHUB_TOKEN=ghp_你的token
#   ./deploy.sh
set -e
cd "$(dirname "$0")"
TOKEN="${GITHUB_TOKEN:?请先设置 GITHUB_TOKEN 环境变量（你的 GitHub Personal Access Token）}"
REPO="zhimahuzzz/personal-fitness-workstation"

echo "==> 构建生产版本..."
npm run build

echo "==> 准备 gh-pages 分支（在临时目录操作，不影响源码）..."
TMP=".workbuddy/deploy-tmp"
rm -rf "$TMP"
git clone --no-hardlinks . "$TMP" -q
cd "$TMP"
git checkout --orphan gh-pages -q
git rm -rf --cached . -q
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r ../../dist/. .
git add -A
git commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M')"

echo "==> 推送 gh-pages（强制覆盖，构建产物分支无历史包袱）..."
git push --force "https://x-access-token:${TOKEN}@github.com/${REPO}.git" gh-pages:gh-pages

cd ../..
rm -rf "$TMP"
echo ""
echo "✅ 部署完成：https://zhimahuzzz.github.io/personal-fitness-workstation/"
echo "   （GitHub Pages 构制约需 1 分钟，稍后刷新即可看到新版本）"
