-- =============================================
-- 老张健身工作台 · M2 训练模块建表脚本
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 可重复执行（幂等），不会产生重复数据
-- =============================================

-- 1. 动作库表（预置动作 user_id 为空 + 用户自定义动作）
create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  muscle_group text not null,
  is_preset boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. 训练日表
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_date date not null default current_date,
  title text,
  notes text,
  created_at timestamptz not null default now()
);

-- 3. 训练组表（每个动作的每一组）
create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  set_index int not null,
  reps int not null,
  weight numeric(6,2) not null default 0,
  created_at timestamptz not null default now()
);

-- 索引：按动作查历史、按训练日查组
create index if not exists idx_sets_exercise on public.workout_sets(exercise_id);
create index if not exists idx_sets_workout on public.workout_sets(workout_id);
create index if not exists idx_workouts_user_date on public.workouts(user_id, workout_date desc);

-- =============================================
-- 行级安全（RLS）策略：每个人只能读写自己的数据，
-- 预置动作（user_id 为空）所有人可读但不可改
-- =============================================

alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_sets enable row level security;

-- exercises：读（含预置）／写（仅自己）
drop policy if exists "ex_select" on public.exercises;
create policy "ex_select" on public.exercises
  for select using (user_id is null or user_id = auth.uid());

drop policy if exists "ex_insert" on public.exercises;
create policy "ex_insert" on public.exercises
  for insert with check (auth.uid() = user_id);

drop policy if exists "ex_update" on public.exercises;
create policy "ex_update" on public.exercises
  for update using (auth.uid() = user_id);

drop policy if exists "ex_delete" on public.exercises;
create policy "ex_delete" on public.exercises
  for delete using (auth.uid() = user_id);

-- workouts：仅自己
drop policy if exists "wo_select" on public.workouts;
create policy "wo_select" on public.workouts
  for select using (auth.uid() = user_id);

drop policy if exists "wo_insert" on public.workouts;
create policy "wo_insert" on public.workouts
  for insert with check (auth.uid() = user_id);

drop policy if exists "wo_delete" on public.workouts;
create policy "wo_delete" on public.workouts
  for delete using (auth.uid() = user_id);

-- workout_sets：仅自己
drop policy if exists "ws_select" on public.workout_sets;
create policy "ws_select" on public.workout_sets
  for select using (auth.uid() = user_id);

drop policy if exists "ws_insert" on public.workout_sets;
create policy "ws_insert" on public.workout_sets
  for insert with check (auth.uid() = user_id);

drop policy if exists "ws_delete" on public.workout_sets;
create policy "ws_delete" on public.workout_sets
  for delete using (auth.uid() = user_id);

-- =============================================
-- 预置力量动作库（常见健身房动作，按肌群分类）
-- =============================================

insert into public.exercises (user_id, name, muscle_group, is_preset)
select null, v.name, v.mg, true
from (values
  -- 胸
  ('杠铃卧推','chest'), ('上斜杠铃卧推','chest'), ('哑铃卧推','chest'),
  ('上斜哑铃卧推','chest'), ('蝴蝶机夹胸','chest'), ('绳索夹胸','chest'), ('双杠臂屈伸','chest'),
  -- 背
  ('引体向上','back'), ('高位下拉','back'), ('坐姿划船','back'), ('杠铃划船','back'),
  ('单臂哑铃划船','back'), ('直臂下压','back'), ('硬拉','back'), ('T杠划船','back'),
  -- 腿
  ('杠铃深蹲','legs'), ('腿举','legs'), ('哈克深蹲','legs'), ('保加利亚分腿蹲','legs'),
  ('腿屈伸','legs'), ('腿弯举','legs'), ('罗马尼亚硬拉','legs'), ('站姿提踵','legs'), ('相扑深蹲','legs'),
  -- 肩
  ('坐姿哑铃推举','shoulders'), ('站姿杠铃推举','shoulders'), ('哑铃侧平举','shoulders'),
  ('哑铃前平举','shoulders'), ('反向飞鸟','shoulders'), ('面拉','shoulders'),
  -- 臂
  ('杠铃弯举','arms'), ('哑铃弯举','arms'), ('锤式弯举','arms'), ('绳索下压','arms'),
  ('仰卧臂屈伸','arms'), ('牧师凳弯举','arms'),
  -- 核心
  ('平板支撑','core'), ('卷腹','core'), ('悬垂举腿','core'), ('俄罗斯转体','core'), ('健腹轮','core')
) as v(name, mg)
where not exists (
  select 1 from public.exercises e
  where e.is_preset = true and e.name = v.name and e.muscle_group = v.mg
);
