# Supabase 配置指南（一次性，约 5 分钟）

你的健身工作台使用 Supabase 免费版作为云端数据库。只需配置一次，之后手机和电脑登录同一账号即可实时同步。

## 第一步：注册账号

1. 打开 https://supabase.com ，点击右上角 **Start your project**
2. 可直接用 GitHub 账号登录，或用邮箱注册（推荐用 GitHub，最快）

## 第二步：创建项目

1. 登录后点击 **New project**
2. 填写：
   - **Name**：`fitness-workstation`（随意）
   - **Database Password**：点 **Generate a password** 自动生成，**复制保存好**（忘记也没关系，本项目用不到它）
   - **Region**：选 `Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)`，离国内近一些
   - 如果看到 **Enable automatic RLS** 选项，**保持勾选**（推荐）——它会自动为新表开启行级安全保护，后续建表的 SQL 里我都会带上对应的访问策略
3. 点击 **Create new project**，等待约 1~2 分钟初始化完成

## 第三步：获取密钥并填入项目

1. 进入项目后，打开左侧 **Project Settings → API**
2. 找到两个值：
   - **Project URL**（形如 `https://xxxxx.supabase.co`）
   - **anon public** 密钥（一长串字符，点旁边的 Copy）
3. 回到项目根目录，把 `.env.example` 复制一份命名为 `.env.local`，填入：

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...你的anon密钥
```

> anon key 是公开密钥，配合数据库行级安全策略（RLS）使用，泄露也不会有数据风险，放心填写。

## 第四步：开启邮箱登录

1. 左侧 **Authentication → Providers**，确认 **Email** 是 Enabled（默认已开启）
2. （可选）**Authentication → Sign In / Up**，关闭 "Confirm email"，注册后无需邮箱验证直接登录

## 第五步：验证

回到终端重启开发服务器（Ctrl+C 后重新 `npm run dev`），刷新页面，注册一个账号即可登录进入工作台。

## 后续说明

- 数据库表（训练记录、饮食、身体状态等）会在各模块开发时由我提供 SQL，在 **SQL Editor** 中粘贴运行即可
- 免费额度：500MB 数据库 + 1GB 文件存储 + 50000 月活用户，个人使用绰绰有余
- 数据完全归你所有，随时可以在控制台导出备份
