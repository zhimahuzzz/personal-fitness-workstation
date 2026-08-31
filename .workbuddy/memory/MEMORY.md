# 项目记忆

## 项目基本信息
- 应用名称：老张健身工作台
- 称呼用户：老板

## 项目定位
个人健身工作台：记录训练/饮食/身体状态，云端同步，AI 建议预留。

## 已确认的关键决策（2026-08-30）
- 平台：响应式网页，手机优先（PWA 可添加到主屏），电脑也可用
- 云端：Supabase 免费版（Auth 邮箱密码登录 + PostgreSQL + Storage），用户要求免费，由我选定 Supabase
- AI：先规则计算，预留 AI 接口；结构化周报可复制给 WorkBuddy 分析
- 健身目标：增肌塑形（热量小盈余 + 蛋白质 1.6-2.2g/kg 为默认建议逻辑）
- 训练类型：健身房/器械力量训练为主
- 饮食记录：每餐拍照【重要：照片仅临时中转给 AI 识别热量，算完即删，不长期存储】+ 文字备注；前期热量按内置食物库按文字估算
- 身体状态：体重/体脂趋势 + 进度照片（每约 10 天拍一次，长期存储于 Storage 时间轴对比）
- 开发节奏：逐模块确认（M1 骨架登录 → M2 训练 → M3 饮食 → M4 状态+仪表盘+目标 → M5 PWA+部署）
- 技术栈：Vite + React 18 + react-router（HashRouter）+ @supabase/supabase-js，纯手写 CSS（无UI框架）

## 约定
- 用户需自行注册 Supabase，配置方法见项目根目录 SETUP-SUPABASE.md
- .env.local 存 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（未配置时应用降级提示）
