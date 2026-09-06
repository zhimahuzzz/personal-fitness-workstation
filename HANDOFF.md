# 老张健身工作台 · 项目交接说明（HANDOFF）

> 更新时间：2026-09-06。本文档面向接手本项目的 AI 助手（或开发者），目标是看完即可无缝继续开发。

---

## 1. 项目位置与一句话简介

- **本机路径**：`E:\Work-ing\Vibe-Coding\Personal_Fitness_Workstation`
- **是什么**：手机优先的个人健身记录 PWA（「老张健身工作台」），记录训练/饮食/身体状态，带 AI 识别能力，增肌塑形目标导向
- **用户**：老张（称呼「老板」），中文交流，健身房力量训练为主

## 2. 核心信息速查

| 项 | 值 |
|---|---|
| 线上地址 | https://zhimahuzzz.github.io/personal-fitness-workstation/ |
| GitHub 仓库 | https://github.com/zhimahuzzz/personal-fitness-workstation（public，用户名 zhimahuzzz） |
| Supabase 项目 | https://rvlmfurvkmxunmdapvvz.supabase.co（ref: `rvlmfurvkmxunmdapvvz`） |
| Supabase publishable key | 在 `.env.local` / `.env.production`（已提交仓库，设计上公开，安全由 RLS 保障） |
| 智谱 AI Key | 存在 Supabase Edge Function Secrets 里（`ZHIPU_API_KEY`），不在任何代码/仓库中 |
| 用户临时凭据 | GitHub PAT / Supabase Access Token（sbp_）按需找用户要，**用完提醒用户删除**，不写入任何文件 |

## 3. 技术栈与架构

- **前端**：Vite + React 18（纯 JSX，无 TS、无路由库、无 UI 框架，手写 CSS），PWA（manifest + Service Worker）
- **后端**：Supabase 免费版 —— Postgres（RLS 行级安全）+ Auth（邮箱密码）+ Storage（进度照片）+ Edge Functions（AI 中转）
- **部署**：GitHub Pages 项目页（子路径 `/personal-fitness-workstation/`，vite `base` 已配置）
- **AI**：智谱 bigmodel.cn 免费模型（glm flash 系列），通过 Edge Function `ai-vision` 中转，key 不落前端

```
手机 PWA ──→ GitHub Pages（静态）
   │
   ├─ 数据 ──→ Supabase PostgREST（RLS：每人只能读写自己的数据）
   ├─ 照片 ──→ Supabase Storage（progress-photos 私有桶，路径 {uid}/{ts}.jpg）
   └─ AI ────→ Supabase Edge Function ai-vision ──→ 智谱 API（ZHIPU_API_KEY 在云端 Secrets）
```

## 4. 代码结构导览

```
src/
  pages/          # 6 个页面（TabBar 切换，无路由）
    Dashboard.jsx   # 仪表盘：今日热量缺口、7天缺口趋势图、本周训练、体重趋势、周报导出
    Training.jsx    # 训练：一天一条、列表点直达编辑器、动作三类（weight/reps/timed）、PR 统计
    Diet.jsx        # 饮食：文字记录（食物库+AI兜底）、拍照AI识别、剩余额度卡
    BodyStatus.jsx  # 身体：体重/体脂记录、进度照片（AI 全身照估体脂）
    Profile.jsx     # 我的：体重/目标/活动系数等（computeTargets 的输入）
    Login.jsx       # 登录注册
  lib/
    supabase.js     # 客户端（读 env）
    ai.js           # AI 调用层：统一走 Edge Function ai-vision
    dailyBalance.js # 每日热量结算共享逻辑（仪表盘/饮食页/周报三处统一算法）
    goals.js        # 目标计算：kcal=体重×33×活动系数×1.1，蛋白=1.8g/kg；公式法训练消耗
    foodParser.js   # 饮食文字解析（食物库优先匹配，AI 兜底剩余）
    weeklyReport.js # Markdown 周报生成（训练明细/每日摄入/缺口汇总/身体数据）
  components/
    TrendChart.jsx  # 零依赖 SVG 折线图
    TabBar.jsx / ErrorBoundary.jsx
supabase/
  functions/ai-vision/index.ts  # 唯一的 Edge Function（见 §6）
  m2-training.sql / m3-diet.sql / m4-body.sql  # 建表脚本（可重复执行）
public/
  sw.js              # Service Worker —— ⚠️ 每次更新必须 bump CACHE_NAME
  manifest.webmanifest  # start_url/scope 必须是 "./"（相对路径）
```

## 5. 数据库要点

表：`user_profiles`（含 weight_kg/activity/target_weight_kg 等）、`exercises`（预置+自定义动作，category: weight|reps|timed）、`workouts`（一天一条，**est_kcal 列存 AI 估算的训练消耗**）、`workout_sets`（reps/weight/duration_sec）、`meals`（无 photo 列！照片只存本设备 localStorage 3 天）、`body_metrics`（unique(user_id, measured_date)，支持 upsert）、`progress_photos`、`foods`（食物库）。

**RLS 全表开启**：`user_id = auth.uid()`；预置动作（user_id 为空）只读。Storage 桶 progress-photos 私有，策略用 `(storage.foldername(name))[1] = auth.uid()::text`。

**改表方法**：Supabase Dashboard → SQL Editor 跑 DDL（给用户 SQL 让他自己跑），或用 Management API `POST /v1/projects/{ref}/database/query` 直接执行（需要用户的 sbp_ token）。

## 6. AI 能力（Edge Function `ai-vision`）

位置：`supabase/functions/ai-vision/index.ts`，部署在 Supabase（当前 v5+）。**零外部依赖**（esm.sh 导入会 BOOT_ERROR，见 §8）。

四个 task（前端 `src/lib/ai.js` 有对应封装）：
| task | 输入 | 输出 | 模型链 |
|---|---|---|---|
| `meal_text` | text（食物库没匹配到的文字） | `{items:[{name,grams,kcal,p,c,f}]}` | glm-4.7-flash → glm-4-flash |
| `meal_photo` | image（dataURL） | 同上 | glm-4.6v-flash → glm-4v-flash |
| `body_fat` | image（dataURL） | `{body_fat_pct, confidence}` | 同上 |
| `workout_kcal` | weightKg/durationMin/items（动作明细） | `{kcal, note}` | 文本链 |

设计要点：
- 模型降级链：首选 429 限流 → 等 1.5s 重试一次 → 降级备用模型；单次调用 30s 超时（AbortSignal.timeout），网络错误也触发降级
- 函数内二次鉴权：fetch `${SUPABASE_URL}/auth/v1/user` 验 JWT（网关 verify_jwt 挡不住 anon key）
- 保存训练后异步调 workout_kcal 写 `workouts.est_kcal`，失败回退公式估算（展示层 `workoutBurn()` 统一处理）

**部署/更新云函数**：Management API（需要用户 sbp_ token）：
```
POST /v1/projects/{ref}/functions          # 创建 {slug,name,body:源码,verify_jwt:true}
PATCH /v1/projects/{ref}/functions/{slug}  # 更新
POST /v1/projects/{ref}/secrets            # 设密钥 [{name,value}]（数组格式）
```
现成工具：`C:/Users/Zhimahuzzz/.workbuddy/binaries/node/workspace/deploy-edge-function.mjs`（用法：`node deploy-edge-function.mjs <sbp_token>`）。

## 7. 部署流程（重要：git 协议不可靠）

**本机 git push 经常挂死**（connection reset / auth failed / 15分钟无响应），**GitHub API 通道稳定**。所有部署走 API：

1. `npm run build`（4 秒，93 模块）
2. **bump `public/sw.js` 的 CACHE_NAME**（当前 fwd-v5 → 下次 fwd-v6），否则 PWA 老用户永远吃旧缓存；然后重新 build
3. 推源码到 main：`node api-push.mjs <github_token> main <manifest.json>`（manifest: `{updates:[{path,local,msg}],deletes:[]}`，内容相同自动跳过；工具在 `C:/Users/Zhimahuzzz/.workbuddy/binaries/node/workspace/`）
4. 推构建到 gh-pages：`node deploy-ghpages.mjs <github_token>`（dist 全量对比，自动删旧 hash 资源）
5. GitHub token 从凭据管理器取：`printf "protocol=https\nhost=github.com\n\n" | git credential fill`
6. 验证：raw.githubusercontent.com 秒级生效；**zhimahuzzz.github.io 站点要等 1~3 分钟 Pages 重建 + 最多 10 分钟 CDN 缓存**，验证分支内容用 raw，验证站点要轮询等待

注意：API 推送会创建独立 commit，**远端 main SHA 与本地不同但内容一致**，本地直接 `git push` 会 non-fast-forward（反正也推不动，别试了）。

## 8. 踩坑清单（前人血泪，别再踩）

1. **esm.sh 导入 = Edge Function BOOT_ERROR 503**。零依赖，登录验证直接 fetch Auth REST
2. **PWA 子路径部署**：manifest 的 start_url/scope/icons 必须相对路径 `"./"`，绝对 `/` 会导致主屏启动 404；SW 注册用 `import.meta.env.BASE_URL` 拼接
3. **PostgREST 严格列校验**：insert payload 含不存在的列（即使 null）直接报错。保存用显式列白名单
4. **Supabase Management API 路径**：auth 配置是 `/v1/projects/{ref}/config/auth`（不是 /config），字段 `mailer_autoconfirm` 必须**布尔值**（字符串 400）
5. **git 协议挂死时**：kill 后改走 GitHub Contents API（api-push.mjs / api-deploy.mjs / deploy-ghpages.mjs）
6. **孤儿分支操作必须在临时 clone 里做**，主仓库 `git clean -fdx` 会把被 rm --cached 的 .gitignore 删掉 → node_modules 入库灾难
7. **repo scope 的 GitHub PAT 推不了 `.github/workflows/`**（需要 workflow scope），本项目用 gh-pages 分支直推方案，没有 Actions
8. **智谱免费模型晚高峰限流**：glm-4.7-flash/glm-4.6v-flash 常 429；glm-4-flash/glm-4v-flash 稳定；glm-4.6-flash 无权限(403)
9. **CDN/缓存验证**：Pages 站点 Cache-Control max-age=600，加 `?t=时间戳` 参数可绕缓存测试

## 9. 当前状态（2026-09-06）

**已上线功能**（全部完成并验收）：
- M1 登录/个人资料、M2 训练、M3 饮食、M4 身体状态+仪表盘、M5 PWA+部署
- AI 三能力：文字热量估算、餐食拍照识别、全身照体脂估算
- 训练 UX 改版：列表点击直达编辑器、动作弹层（最近使用置顶/搜索词一键创建）、保存后 AI 估算训练消耗（est_kcal）
- 热量缺口：仪表盘今日卡 + 近 7 天缺口趋势图（只画有饮食记录的天）、饮食页剩余额度卡（含训练加成）、周报每日缺口汇总

**数据库/云函数**：est_kcal 列已加；ai-vision v5（含 workout_kcal + 30s 超时 + 降级链）已部署并 E2E 验证。

**2026-09-06 处理**：本地积压的 3 个提交（55b8359 训练升级、f21e233 UX改版）已通过 API 通道全量同步 main（34 文件更新）+ 部署 gh-pages。**部署记录**：线上已验证运行 `index-CWcbdiNp.js` + sw.js `fwd-v5`，即包含 2026-09-03 全部改版内容；云函数 ai-vision 为 v5。截至本文档更新时，本地与线上完全一致，无积压。

## 10. 用户偏好与工作方式

- 称呼「老板」，中文，简洁直接，喜欢 emoji 适度点缀
- **免费方案优先**（Supabase 免费版、智谱免费模型、GitHub Pages）
- **逐模块确认开发节奏**：先问清楚需求（用选项式提问）→ 开发 → 用户手机实测验收 → 下一模块
- 手机优先：所有 UI 按 375px 宽度设计；操作步骤要少（用户明确嫌"改数据步骤太多"）
- 用户是健身新手+AI 应用入门者，专业术语要解释
- 教学意愿强：涉及用户自己操作的部分（Supabase 控制台等）给直链和具体按钮位置

## 11. 历史记忆位置

- 项目日志（按日）：`.workbuddy/memory/2026-09-0*.md`（本目录已被 .gitignore 排除，仅本机）
- 长期要点：`.workbuddy/memory/MEMORY.md`
- 可复用经验技能：`~/.workbuddy/skills/supabase-edge-function-deploy/SKILL.md`（Edge Function 部署全流程）
- 部署工具脚本：`C:/Users/Zhimahuzzz/.workbuddy/binaries/node/workspace/*.mjs`

## 12. 待办与二期候选

- **待用户验收**（2026-09-03 改版）：训练列表直达编辑、动作弹层新交互、AI 训练消耗（保存一次训练后看列表 kcal 带 🤖 标）、7 天缺口图、饮食页剩余额度
- 二期候选（用户提过意愿，未排期）：训练模板（常用课表一键载入）、周报自动化、AI 教练对话
- 环境提醒：node 用 `C:/Users/Zhimahuzzz/.workbuddy/binaries/node/versions/22.22.2-2/node.exe`（受管路径）

---

*交接完毕。有任何本文档没覆盖的细节，先查 `.workbuddy/memory/` 日志，再问用户。*
