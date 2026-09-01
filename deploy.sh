#!/usr/bin/env bash
# 一键部署脚本：构建 + 推送 gh-pages 分支（GitHub Pages 自动更新）
# 用法：在仓库根目录执行 bash deploy.sh
# 注意：首次推送会弹出 GitHub 登录窗口，按提示授权即可
set -e

echo "==> 构建..."
npm run build

echo "==> 准备部署分支..."
git checkout -b deploy-tmp
git add -f dist
git commit -m "build: $(date '+%Y-%m-%d %H:%M:%S')"
git subtree split --prefix dist -b gh-pages-new

echo "==> 推送 gh-pages..."
git push origin gh-pages-new:gh-pages --force

echo "==> 清理临时分支..."
git checkout main
git branch -D deploy-tmp gh-pages-new

echo ""
echo "✅ 部署完成！稍等 1~2 分钟生效："
echo "   https://zhimahuzzz.github.io/personal-fitness-workstation/"
