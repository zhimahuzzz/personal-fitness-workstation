-- ============================================================
-- M4：身体状态 + 仪表盘 + 目标设定
-- body_metrics（体重/体脂记录）、progress_photos（进度照片索引）、
-- user_profiles 扩展列（目标体重/身高/年龄/性别/经验/每周天数）、
-- progress-photos 私有存储桶 + 策略
-- 幂等可重复执行
-- ============================================================

-- 1. 身体数据记录（每天最多一条，同日再记录为覆盖）
create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_date date not null default current_date,
  weight_kg numeric(5,1),
  body_fat_pct numeric(4,1),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, measured_date)
);

-- 2. 进度照片索引（照片本体存 Storage 私有桶，此表只存元信息）
create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  taken_date date not null default current_date,
  storage_path text not null,
  note text,
  created_at timestamptz not null default now()
);

-- 3. user_profiles 扩展：目标设定所需字段
alter table public.user_profiles add column if not exists target_weight_kg numeric(5,1);
alter table public.user_profiles add column if not exists height_cm numeric(5,1);
alter table public.user_profiles add column if not exists age int;
alter table public.user_profiles add column if not exists gender text;
alter table public.user_profiles add column if not exists experience text default 'beginner';
alter table public.user_profiles add column if not exists weekly_days int default 4;

-- ===== RLS 策略 =====
alter table public.body_metrics enable row level security;
alter table public.progress_photos enable row level security;

drop policy if exists "own body_metrics all" on public.body_metrics;
create policy "own body_metrics all" on public.body_metrics
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own progress_photos all" on public.progress_photos;
create policy "own progress_photos all" on public.progress_photos
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 进度照片存储桶（私有，仅本人可读写） =====
insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;

-- 桶内对象按 "用户id/xxx.jpg" 前缀隔离
drop policy if exists "own progress photos read" on storage.objects;
create policy "own progress photos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own progress photos write" on storage.objects;
create policy "own progress photos write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own progress photos delete" on storage.objects;
create policy "own progress photos delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text);
