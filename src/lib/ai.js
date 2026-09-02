// AI 识别调用层：统一走 Supabase Edge Function（ai-vision），key 存在云端密钥管理里
import { supabase } from './supabase'

async function invoke(task, payload = {}) {
  if (!supabase) throw new Error('云服务未配置')
  const { data, error } = await supabase.functions.invoke('ai-vision', { body: { task, ...payload } })
  if (error) {
    // functions.invoke 抛的 FunctionsHttpError 里 context 是 Response，尝试取回后端错误信息
    let msg = error.message || 'AI 服务异常'
    try {
      const body = typeof error.context?.text === 'function'
        ? await error.context.text()
        : (error.context?.text || '')
      const parsed = JSON.parse(body)
      if (parsed?.error) msg = parsed.error
    } catch { /* 保持默认信息 */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

// AI 条目补上每 100g 营养值，让「改克数重算」在编辑器里可用
export const withPer100 = items => (items || []).map(it => ({
  ...it,
  kcal100: it.grams > 0 ? Math.round(it.kcal / it.grams * 100) : it.kcal,
  p100: it.grams > 0 ? Math.round(it.p / it.grams * 100 * 10) / 10 : it.p,
  c100: it.grams > 0 ? Math.round(it.c / it.grams * 100 * 10) / 10 : it.c,
  f100: it.grams > 0 ? Math.round(it.f / it.grams * 100 * 10) / 10 : it.f,
}))

// 文字估算（食物库兜底用）：text 如「宫保鸡丁一份」，返回 [{name, grams, kcal, p, c, f}]
export const aiEstimateMealText = async text => {
  const { items } = await invoke('meal_text', { text })
  return withPer100(items)
}

// 餐食照片识别：image 为 dataURL
export const aiRecognizeMealPhoto = async image => {
  const { items } = await invoke('meal_photo', { image })
  return withPer100(items)
}

// 全身照估体脂：返回 { body_fat_pct, confidence }
export const aiEstimateBodyFat = image => invoke('body_fat', { image })
