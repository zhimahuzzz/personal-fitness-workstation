// 增肌塑形目标计算（规则版，预留 AI 升级接口）
// 公式：每日热量 = 体重kg × 33 × 活动系数 × 1.1（小盈余）；蛋白质 = 1.8g/kg

export const ACTIVITY_OPTIONS = [
  { value: 1.375, label: '久坐少动' },
  { value: 1.55, label: '轻度活动' },
  { value: 1.725, label: '中度活动' },
  { value: 1.9, label: '高强度' },
]

export const EXPERIENCE_OPTIONS = [
  { id: 'beginner', label: '新手 <1年' },
  { id: 'intermediate', label: '进阶 1-3年' },
  { id: 'advanced', label: '老手 3年+' },
]

/**
 * 计算每日热量与蛋白质目标
 * @param {{weight_kg:number, activity?:number}} profile
 * @returns {{kcal:number, protein:number, tdee:number}|null} 无体重时返回 null
 */
export function computeTargets(profile) {
  if (!profile?.weight_kg) return null
  const w = Number(profile.weight_kg)
  const act = Number(profile.activity) || 1.55
  const tdee = Math.round(w * 33 * act)
  const kcal = Math.round((tdee * 1.1) / 10) * 10
  const protein = Math.round(w * 1.8)
  return { kcal, protein, tdee }
}

/**
 * 目标体重达成进度
 * @param {{start:number, current:number, target:number}} p
 * @returns {{pct:number, text:string}|null}
 */
export function goalProgress({ start, current, target }) {
  if (start == null || current == null || target == null) return null
  const total = target - start
  if (Math.abs(total) < 0.05) return { pct: 1, text: '已达成' } // 起点即目标
  const done = (current - start) / total
  const pct = Math.max(0, Math.min(1, done))
  const gained = Math.abs(current - start)
  const need = Math.abs(total)
  const verb = total > 0 ? '已增' : '已减'
  const left = Math.max(0, need - gained)
  const text = done >= 1
    ? `${verb} ${gained.toFixed(1)} kg，目标达成 🎉`
    : `${verb} ${gained.toFixed(1)} / ${need.toFixed(1)} kg，还差 ${left.toFixed(1)} kg`
  return { pct, text }
}
