# 老张健身工作台

个人健身记录与数据分析应用：训练 / 饮食 / 身体状态一站式记录，面向增肌塑形目标。

**在线使用**：https://zhimahuzzz.github.io/personal-fitness-workstation/

## 功能

- **训练记录**：预置 40+ 力量动作库（按肌群），记录组数×次数×重量，自动对比上次成绩与历史最好（估算 1RM），训练草稿防丢
- **饮食记录**：一句话描述（如「鸡蛋2个 牛奶一杯」）自动匹配食物库估算热量与三大营养素，每日摄入对比增肌目标
- **身体状态**：体重/体脂趋势曲线（手绘 SVG，零依赖），进度照片时间轴（每 10 天提醒），云端同步
- **仪表盘**：今日热量/蛋白质进度、本周训练天数与容量、体重趋势与目标达成度
- **周报导出**：一键生成结构化 Markdown 周报，复制给任意 AI 获取个性化训练/饮食建议
- **PWA**：手机浏览器「添加到主屏幕」即可当原生 App 使用，支持离线打开

## 技术栈

- 前端：Vite + React（移动端优先响应式，HashRouter）
- 后端：Supabase 免费版（邮箱密码登录 + PostgreSQL + RLS 行级安全 + Storage 进度照片）
- 部署：GitHub Pages（gh-pages 分支直推构建产物）

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入你的 Supabase URL 和 anon key
npm run dev
```

数据库表结构见 `supabase/` 目录（m2 训练 / m3 饮食 / m4 身体状态，幂等可重复执行）。

## 部署更新

```bash
export GITHUB_TOKEN=ghp_你的token
./deploy.sh
```

## 说明

- 所有用户数据存储在各自 Supabase 账号下，由 RLS 策略保证数据隔离
- 饮食照片仅存本设备（3 天自动清理，不上云）；进度照片存云端私有桶（仅本人可见）
- AI 能力（拍照识别热量/体脂估算）为规划中的二期功能，当前热量由内置食物库规则计算
