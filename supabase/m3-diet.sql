-- =============================================
-- 老张健身工作台 · M3 饮食模块建表脚本
-- 使用方法：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 可重复执行（幂等），不会产生重复数据
-- =============================================

-- 1. 食物库（预置食物 user_id 为空；每 100g 的营养值 + 默认单位重量）
create table if not exists public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  kcal numeric(6,2) not null default 0,
  protein numeric(6,2) not null default 0,
  carbs numeric(6,2) not null default 0,
  fat numeric(6,2) not null default 0,
  unit_name text not null default '份',
  unit_grams numeric(7,2) not null default 100,
  is_preset boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. 餐次记录（items 为解析后的食物明细 jsonb；照片不存云端）
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null default current_date,
  meal_type text not null default 'snack',
  note text,
  items jsonb not null default '[]',
  kcal numeric(8,2) not null default 0,
  protein numeric(7,2) not null default 0,
  carbs numeric(7,2) not null default 0,
  fat numeric(7,2) not null default 0,
  created_at timestamptz not null default now()
);

-- 3. 用户身体数据（用于计算每日热量/蛋白质目标）
create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  weight_kg numeric(5,1),
  height_cm numeric(5,1),
  age int,
  gender text,
  activity numeric(4,2) not null default 1.55,
  goal text not null default 'muscle_gain',
  updated_at timestamptz not null default now()
);

create index if not exists idx_meals_user_date on public.meals(user_id, meal_date desc);

-- =============================================
-- RLS 策略
-- =============================================

alter table public.foods enable row level security;
alter table public.meals enable row level security;
alter table public.user_profiles enable row level security;

-- foods：预置所有人可读，自定义仅自己读写
drop policy if exists "fd_select" on public.foods;
create policy "fd_select" on public.foods
  for select using (user_id is null or user_id = auth.uid());
drop policy if exists "fd_insert" on public.foods;
create policy "fd_insert" on public.foods
  for insert with check (auth.uid() = user_id);

-- meals：仅自己
drop policy if exists "ml_select" on public.meals;
create policy "ml_select" on public.meals
  for select using (auth.uid() = user_id);
drop policy if exists "ml_insert" on public.meals;
create policy "ml_insert" on public.meals
  for insert with check (auth.uid() = user_id);
drop policy if exists "ml_delete" on public.meals;
create policy "ml_delete" on public.meals
  for delete using (auth.uid() = user_id);

-- user_profiles：仅自己
drop policy if exists "up_select" on public.user_profiles;
create policy "up_select" on public.user_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "up_insert" on public.user_profiles;
create policy "up_insert" on public.user_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "up_update" on public.user_profiles;
create policy "up_update" on public.user_profiles
  for update using (auth.uid() = user_id);

-- =============================================
-- 预置食物库（每 100g 营养值，常见中式饮食）
-- =============================================

insert into public.foods (user_id, name, kcal, protein, carbs, fat, unit_name, unit_grams, is_preset)
select null, v.name, v.kcal, v.p, v.c, v.f, v.un, v.ug, true
from (values
  -- 主食
  ('米饭(熟)',116,2.6,25.9,0.3,'碗',200),
  ('面条(熟)',110,3.6,22.0,0.5,'碗',250),
  ('馒头',223,7.0,47.0,1.0,'个',100),
  ('全麦面包',246,10.0,45.0,3.5,'片',40),
  ('燕麦',377,13.0,67.0,7.0,'勺',15),
  ('白粥',30,1.0,7.0,0.1,'碗',250),
  ('红薯',86,1.6,20.0,0.1,'个',150),
  ('土豆',77,2.0,17.0,0.1,'个',150),
  ('玉米',112,4.0,22.8,1.2,'根',200),
  ('意面(熟)',158,5.8,31.0,0.9,'碗',220),
  ('包子',227,8.4,30.0,8.0,'个',100),
  ('饺子',218,9.0,26.0,8.0,'个',25),
  ('炒饭',180,5.0,25.0,7.0,'碗',250),
  -- 蛋白质
  ('鸡蛋',144,13.3,2.8,8.8,'个',55),
  ('鸡胸肉',133,24.0,0.0,3.0,'块',120),
  ('鸡腿',181,16.0,0.0,13.2,'个',120),
  ('牛肉',143,20.0,1.8,6.4,'份',100),
  ('瘦肉',143,20.0,1.5,6.5,'份',100),
  ('五花肉',508,7.7,0.0,50.0,'份',50),
  ('三文鱼',139,17.2,0.0,7.8,'块',120),
  ('虾',93,18.6,2.8,0.8,'份',100),
  ('豆腐',84,8.1,4.2,3.7,'块',100),
  ('豆浆',31,3.0,1.2,1.6,'杯',250),
  ('牛奶',54,3.0,3.4,3.2,'杯',250),
  ('酸奶',72,2.8,9.3,2.7,'杯',200),
  ('蛋白粉',400,80.0,5.0,5.0,'勺',30),
  ('培根',181,22.0,1.0,10.0,'片',15),
  ('香肠',508,24.0,11.0,40.0,'根',60),
  -- 蔬果
  ('西兰花',36,4.1,4.3,0.6,'份',150),
  ('生菜',15,1.4,2.0,0.2,'份',100),
  ('番茄',20,0.9,4.0,0.2,'个',150),
  ('黄瓜',16,0.8,2.9,0.2,'根',200),
  ('胡萝卜',39,1.0,8.8,0.2,'根',150),
  ('香蕉',93,1.4,22.0,0.2,'根',120),
  ('苹果',53,0.4,14.0,0.2,'个',200),
  ('橙子',48,0.8,12.0,0.2,'个',180),
  -- 油脂坚果
  ('橄榄油',884,0.0,0.0,100.0,'勺',10),
  ('花生',574,26.0,21.0,50.0,'把',15),
  ('杏仁',579,15.0,50.0,50.0,'把',15),
  ('核桃',646,14.0,20.0,65.0,'个',10),
  -- 饮品与外食
  ('可乐',43,0.0,10.6,0.0,'杯',330),
  ('黑咖啡',2,0.1,0.0,0.0,'杯',250),
  ('橙汁',45,0.7,10.0,0.2,'杯',250),
  ('奶茶',120,1.0,18.0,4.0,'杯',500),
  ('汉堡',250,13.0,30.0,9.0,'个',200),
  ('薯条',312,3.4,41.0,15.0,'份',100),
  ('炸鸡',279,16.0,15.0,18.0,'份',150),
  ('披萨',266,11.0,33.0,10.0,'块',100)
) as v(name,kcal,p,c,f,un,ug)
where not exists (
  select 1 from public.foods f2
  where f2.is_preset = true and f2.name = v.name
);
