/**
 * 生成本周（过去 7 天）训练/饮食/身体数据汇总周报（Markdown）
 * 复制后可直接丢给 AI（WorkBuddy 等）做个性化分析建议
 */
const pad = n => String(n).padStart(2, '0')
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayLabel = ds => { const d = new Date(ds + 'T00:00:00'); return `周${'日一二三四五六'[d.getDay()]}` }

export function buildWeeklyReport({ profile = {}, workouts = [], sets = [], meals = [], metrics = [], exercises = [] }) {
  const today = new Date()
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - 6)
  const ws = fmt(weekStart)
  const we = fmt(today)

  const exMap = new Map(exercises.map(e => [e.id, e]))
  const setLabel = s => {
    const cat = exMap.get(s.exercise_id)?.category || 'weight'
    if (cat === 'timed') return `${s.duration_sec || 0}秒`
    if (cat === 'reps') return `${s.reps}次`
    return `${s.reps}次×${Number(s.weight)}kg`
  }

  // 训练：按训练日聚合
  const setsByW = new Map()
  for (const s of sets) {
    if (!setsByW.has(s.workout_id)) setsByW.set(s.workout_id, [])
    setsByW.get(s.workout_id).push(s)
  }
  const workoutsByDate = new Map()
  for (const w of workouts) {
    if (!workoutsByDate.has(w.workout_date)) workoutsByDate.set(w.workout_date, [])
    workoutsByDate.get(w.workout_date).push(w)
  }
  const isWeightSet = s => (exMap.get(s.exercise_id)?.category || 'weight') === 'weight'
  const weekVolume = sets.filter(isWeightSet).reduce((sum, s) => sum + Number(s.reps || 0) * Number(s.weight || 0), 0)
  const weekDays = workoutsByDate.size

  // 饮食：按日聚合
  const mealsByDate = new Map()
  for (const m of meals) {
    if (!mealsByDate.has(m.meal_date)) mealsByDate.set(m.meal_date, { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 })
    const agg = mealsByDate.get(m.meal_date)
    agg.kcal += Number(m.kcal || 0)
    agg.protein += Number(m.protein || 0)
    agg.carbs += Number(m.carbs || 0)
    agg.fat += Number(m.fat || 0)
    agg.count += 1
  }
  const dietDays = mealsByDate.size
  const avgKcal = dietDays ? mealsByDate.size === 0 ? 0 : [...mealsByDate.values()].reduce((s, v) => s + v.kcal, 0) / 7 : 0
  const avgProtein = dietDays ? [...mealsByDate.values()].reduce((s, v) => s + v.protein, 0) / 7 : 0

  // 体重：取本周内及最近一次
  const weekMetrics = metrics.filter(m => m.measured_date >= ws && m.measured_date <= we)
  const weightRows = weekMetrics.filter(m => m.weight_kg != null)
  const wStart = weightRows[0]?.weight_kg
  const wEnd = weightRows[weightRows.length - 1]?.weight_kg
  const wDelta = wStart != null && wEnd != null ? (wEnd - wStart).toFixed(1) : null

  // TDEE / 目标
  const tdee = profile.weight_kg ? Math.round(profile.weight_kg * 33 * Number(profile.activity || 1.55)) : null
  const kcalTarget = tdee ? Math.round(tdee * 1.1 / 10) * 10 : null
  const proteinTarget = profile.weight_kg ? Math.round(profile.weight_kg * 1.8) : null

  // 训练消耗估算（AI 估算值优先，无则净MET=5，时长缺省按每组2.5分钟）
  const estKcal = w => {
    if (Number(w.est_kcal) > 0) return Math.round(Number(w.est_kcal))
    const n = (setsByW.get(w.id) || []).length
    if (!n || !profile.weight_kg) return 0
    const mins = Number(w.duration_min) > 0 ? Number(w.duration_min) : n * 2.5
    return Math.round(5 * Number(profile.weight_kg) * (mins / 60))
  }
  const weekKcal = workouts.reduce((s, w) => s + estKcal(w), 0)
  const aiKcalDays = workouts.filter(w => Number(w.est_kcal) > 0).length

  const lines = []
  lines.push(`# 老张健身工作台 · 周报（${ws} ~ ${we}）`)
  lines.push('')
  lines.push('## 目标与设定')
  lines.push(`- 目标：增肌塑形`)
  if (profile.weight_kg) lines.push(`- 当前体重 ${profile.weight_kg} kg${profile.target_weight_kg ? ` → 目标 ${profile.target_weight_kg} kg` : ''}`)
  if (profile.experience) lines.push(`- 训练经验：${({ beginner: '新手 <1年', intermediate: '进阶 1-3年', advanced: '老手 3年+' })[profile.experience] || profile.experience}`)
  if (profile.weekly_days) lines.push(`- 每周计划训练 ${profile.weekly_days} 天`)
  if (kcalTarget) lines.push(`- 每日热量目标 ≈ ${kcalTarget} kcal（${tdee}×1.1）`)
  if (proteinTarget) lines.push(`- 每日蛋白质目标 ≈ ${proteinTarget} g（1.8 g/kg）`)
  lines.push('')

  lines.push('## 本周训练')
  if (workouts.length === 0) {
    lines.push('- 本周无训练记录')
  } else {
    lines.push(`- 训练场次：${workouts.length}（共 ${weekDays} 个不同日期）${profile.weekly_days ? `，计划 ${profile.weekly_days} 天，达成 ${weekDays >= profile.weekly_days ? '✅' : '⏳'}` : ''}`)
    lines.push(`- 总训练容量：${weekVolume.toLocaleString()} kg（仅重量型动作）`)
    lines.push(`- 本周训练估算消耗：约 ${weekKcal} kcal${aiKcalDays ? `（其中 ${aiKcalDays} 天为 AI 按动作明细估算）` : ''}`)
    lines.push('- 训练明细：')
    const sorted = [...workouts].sort((a, b) => a.workout_date.localeCompare(b.workout_date))
    for (const w of sorted) {
      const wKcal = estKcal(w)
      lines.push(`  - ${w.workout_date} ${dayLabel(w.workout_date)}：${w.title || '（无标题）'}${wKcal ? `，约 ${wKcal} kcal` : ''}`)
      const wSets = setsByW.get(w.id) || []
      if (wSets.length) {
        const byEx = new Map()
        for (const s of wSets) {
          if (!byEx.has(s.exercise_id)) byEx.set(s.exercise_id, [])
          byEx.get(s.exercise_id).push(s)
        }
        for (const [eid, list] of byEx) {
          const detail = list
            .sort((a, b) => a.set_index - b.set_index)
            .map(setLabel).join('，')
          lines.push(`    - ${exMap.get(eid)?.name || `动作#${String(eid).slice(0, 6)}`}：${detail}`)
        }
      }
    }
  }
  lines.push('')

  lines.push('## 本周饮食')
  if (meals.length === 0) {
    lines.push('- 本周无饮食记录')
  } else {
    lines.push(`- 共记录 ${meals.length} 餐，覆盖 ${dietDays} 天`)
    lines.push(`- 日均热量 ≈ ${Math.round(avgKcal)} kcal${kcalTarget ? `（目标 ${kcalTarget}，${avgKcal < kcalTarget - 200 ? '偏低' : avgKcal > kcalTarget + 200 ? '偏高' : '达标'}）` : ''}`)
    lines.push(`- 日均蛋白质 ≈ ${Math.round(avgProtein)} g${proteinTarget ? `（目标 ${proteinTarget}，${avgProtein < proteinTarget ? '不足' : '达标'}）` : ''}`)
    lines.push('- 每日摄入：')
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      const ds = fmt(d)
      const agg = mealsByDate.get(ds)
      if (agg) lines.push(`  - ${ds} ${dayLabel(ds)}：${Math.round(agg.kcal)} kcal / 蛋白 ${Math.round(agg.protein)} g（${agg.count} 餐）`)
    }
  }
  lines.push('')

  // 每日热量缺口（仅统计有饮食记录的日子）
  if (kcalTarget && meals.length > 0) {
    lines.push('')
    lines.push('## 每日热量缺口')
    lines.push(`- 缺口 = 摄入 −（目标 ${kcalTarget} + 当日训练消耗）；正值盈余/负值缺口`)
    let sumGap = 0, gapDays = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      const ds = fmt(d)
      const agg = mealsByDate.get(ds)
      if (!agg || agg.kcal <= 0) continue
      const dayBurn = (workoutsByDate.get(ds) || []).reduce((s, w) => s + estKcal(w), 0)
      const g = Math.round(agg.kcal - (kcalTarget + dayBurn))
      sumGap += g
      gapDays += 1
      lines.push(`  - ${ds} ${dayLabel(ds)}：摄入 ${Math.round(agg.kcal)} − 目标 ${kcalTarget}${dayBurn ? ` − 训练 ${dayBurn}` : ''} = ${g >= 0 ? `盈余 ${g}` : `缺口 ${g}`} kcal`)
    }
    if (gapDays) lines.push(`- 合计（${gapDays} 个记录日）：${sumGap >= 0 ? `盈余 ${Math.round(sumGap)}` : `缺口 ${Math.round(-sumGap)}`} kcal，日均 ${sumGap >= 0 ? '盈余' : '缺口'} ${Math.abs(Math.round(sumGap / gapDays))} kcal`)
  }
  lines.push('')

  lines.push('## 身体数据')
  if (weightRows.length === 0) {
    lines.push('- 本周无体重记录')
  } else {
    lines.push(`- 体重：${wStart} → ${wEnd} kg（${wDelta > 0 ? '+' : ''}${wDelta} kg）`)
    const fatRows = weekMetrics.filter(m => m.body_fat_pct != null)
    if (fatRows.length) {
      const fStart = fatRows[0].body_fat_pct
      const fEnd = fatRows[fatRows.length - 1].body_fat_pct
      lines.push(`- 体脂：${fStart} → ${fEnd} %（${(fEnd - fStart).toFixed(1)}%）`)
    }
  }
  lines.push('')

  lines.push('## AI 分析请求')
  lines.push('请基于以上数据，从以下角度给我分析与建议：')
  lines.push('1. 训练量与计划匹配度，是否需要调整')
  lines.push('2. 饮食是否支持当前增肌目标，热量/蛋白质是否合适')
  lines.push('3. 体重/体脂变化趋势是否健康')
  lines.push('4. 下周具体可执行的调整建议（动作/容量/饮食）')

  return lines.join('\n')
}
