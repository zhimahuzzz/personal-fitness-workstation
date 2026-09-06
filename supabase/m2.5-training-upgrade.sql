-- =============================================
-- 老张健身工作台 · 训练模块升级（三类动作 + 可编辑 + 时长）
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 可重复执行（幂等），不会产生重复数据
-- =============================================

-- 1. 动作库加类型字段：weight=重量型(次数×重量) / reps=自重次数型 / timed=计时型(秒)
alter table public.exercises add column if not exists category text not null default 'weight';

-- 2. 训练组加计时字段（计时型动作记秒数，此时 weight=0 reps=0）
alter table public.workout_sets add column if not exists duration_sec int;

-- 3. 训练日加时长字段（分钟，可空；不填则前端按组数估算）
alter table public.workouts add column if not exists duration_min int;

-- 4. 预置库标注类型
-- 计时型
update public.exercises set category = 'timed'
where is_preset = true and name in ('平板支撑');

-- 自重次数型（核心 + 自重复合动作）
update public.exercises set category = 'reps'
where is_preset = true and name in (
  '悬垂举腿', '卷腹', '俄罗斯转体', '健腹轮',
  '引体向上', '双杠臂屈伸'
);

-- 其余保持默认 weight（幂等兜底：显式标一遍）
update public.exercises set category = 'weight'
where is_preset = true and category not in ('weight', 'reps', 'timed');

-- 5. 补 update 策略（原表只有 select/insert/delete，编辑功能必需）
drop policy if exists "ws_update" on public.workout_sets;
create policy "ws_update" on public.workout_sets
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "wo_update" on public.workouts;
create policy "wo_update" on public.workouts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
