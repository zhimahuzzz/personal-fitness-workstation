// 饮食文字解析：把「鸡蛋2个 牛奶一杯 米饭一碗」拆成带热量的食物明细

// 固定换算的单位（克数/个）
const HARD_UNITS = {
  克: 1, g: 1, G: 1, ml: 1, ML: 1, 毫升: 1,
  两: 50,
}
const UNIT_RE = /(克|g|G|ml|ML|毫升|两|个|碗|杯|片|勺|根|盒|袋|份|块|把)/

// 从食物生成一条明细（按克数计算）
export function makeItem(food, grams) {
  const k = grams / 100
  return {
    name: food.name,
    grams: Math.round(grams),
    kcal: Math.round((Number(food.kcal) || 0) * k),
    p: Math.round((Number(food.protein) || 0) * k * 10) / 10,
    c: Math.round((Number(food.carbs) || 0) * k * 10) / 10,
    f: Math.round((Number(food.fat) || 0) * k * 10) / 10,
    // 保留每100g数值，便于修改克数时重算
    kcal100: Number(food.kcal) || 0,
    p100: Number(food.protein) || 0,
    c100: Number(food.carbs) || 0,
    f100: Number(food.fat) || 0,
  }
}

// 解析一句话饮食描述
export function parseMealText(text, foods) {
  const fragments = String(text || '').split(/[,，、;；\s]+/).filter(Boolean)
  if (!fragments.length) return { items: [], unmatched: [] }
  // 名称长的优先匹配（如「全麦面包」先于「面包」）
  const sorted = [...foods].sort((a, b) => b.name.length - a.name.length)
  const items = []
  const unmatched = []
  for (const frag of fragments) {
    const food = sorted.find(f => frag.includes(f.name))
    if (!food) { unmatched.push(frag); continue }
    const rest = frag.replace(food.name, '')
    const m = rest.match(/(\d+(?:\.\d+)?)?\s*(克|g|G|ml|ML|毫升|两|个|碗|杯|片|勺|根|盒|袋|份|块|把)?/)
    const num = m && m[1] ? parseFloat(m[1]) : 1
    const unit = (m && m[2]) || food.unit_name || '份'
    let grams
    if (HARD_UNITS[unit] != null) grams = num * HARD_UNITS[unit]
    else if (unit === food.unit_name) grams = num * Number(food.unit_grams || 100)
    else grams = num * Number(food.unit_grams || 100) // 其他量词按默认单位估
    if (!(grams > 0)) grams = Number(food.unit_grams || 100)
    items.push(makeItem(food, grams))
  }
  return { items, unmatched }
}

// 汇总
export function sumItems(items) {
  return (items || []).reduce((acc, it) => ({
    kcal: acc.kcal + (Number(it.kcal) || 0),
    p: acc.p + (Number(it.p) || 0),
    c: acc.c + (Number(it.c) || 0),
    f: acc.f + (Number(it.f) || 0),
  }), { kcal: 0, p: 0, c: 0, f: 0 })
}
