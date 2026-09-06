// 每日热量结算（摄入 vs 目标+训练消耗）共享逻辑
// 供仪表盘 / 饮食页 / 周报统一使用，保证三处算法一致
import { computeTargets, estimateWorkoutKcal } from './goals'

const pad = n => String(n).padStart(2, '0')
export const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * 单次训练的净消耗（kcal）：优先 AI 估算值（workouts.est_kcal），无则回退公式
 */
export function workoutBurn(wo, setCount, weightKg) {
  if (Number(wo?.est_kcal) > 0) return { kcal: Math.round(Number(wo.est_kcal)), source: 'ai' }
  return {
    kcal: estimateWorkoutKcal({ setCount, durationMin: wo?.duration_min, weightKg }),
    source: 'formula',
  }
}

/**
 * 近 nDays 天（含今天）每日热量结算
 * @param {{mealsByDate:Object, workoutsByDate:Object, setCountByWorkout:Object, profile:Object, nDays?:number}} p
 *   mealsByDate: { 'YYYY-MM-DD': [{kcal}, ...] }
 *   workoutsByDate: { 'YYYY-MM-DD': [workout, ...] }（需含 est_kcal、duration_min）
 *   setCountByWorkout: { workoutId: 组数 }
 * @returns {{days:[{date, intake, burn, gap}], targets:{kcal,protein,tdee}}|null} 无目标（没填体重）返回 null
 */
export function buildDailyBalance({ mealsByDate = {}, workoutsByDate = {}, setCountByWorkout = {}, profile, nDays = 7 }) {
  const targets = computeTargets(profile)
  if (!targets) return null
  const days = []
  const today = new Date()
  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = dateKey(d)
    const intake = Math.round((mealsByDate[key] || []).reduce((s, m) => s + Number(m.kcal || 0), 0))
    let burn = 0
    for (const w of (workoutsByDate[key] || [])) {
      burn += workoutBurn(w, setCountByWorkout[w.id] || 0, profile?.weight_kg).kcal
    }
    days.push({ date: key, intake, burn, gap: Math.round(intake - (targets.kcal + burn)) })
  }
  return { days, targets }
}
