import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { parseMealText, makeItem, sumItems } from '../lib/foodParser'

const MEAL_TYPES = [
  { id: 'breakfast', label: '早餐' },
  { id: 'lunch', label: '午餐' },
  { id: 'dinner', label: '晚餐' },
  { id: 'snack', label: '加餐' },
]
const mtLabel = id => (MEAL_TYPES.find(m => m.id === id) || {}).label || '加餐'

const pad = n => String(n).padStart(2, '0')
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const shiftDate = (s, days) => {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---- 本地临时照片（仅本设备、3天后自动清理，不上云） ----
const PHOTO_KEY = 'fwd_meal_photos_v1'
const loadPhotoMap = () => {
  try {
    const map = JSON.parse(localStorage.getItem(PHOTO_KEY)) || {}
    const cutoff = Date.now() - 3 * 864e5
    for (const k of Object.keys(map)) if (map[k].ts < cutoff) delete map[k]
    return map
  } catch { return {} }
}
const savePhotoMap = map => {
  try { localStorage.setItem(PHOTO_KEY, JSON.stringify(map)) } catch { /* 存储满则忽略 */ }
}
// 压缩图片为小尺寸 dataURL，避免占满 localStorage
function compressImage(file, cb) {
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const max = 480
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      cb(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

export default function Diet() {
  const { user } = useAuth()
  const [date, setDate] = useState(todayStr())
  const [meals, setMeals] = useState([])
  const [foods, setFoods] = useState([])
  const [profile, setProfile] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [photos, setPhotos] = useState({})

  const loadMeals = useCallback(async () => {
    if (!supabase || !user) return
    const { data } = await supabase.from('meals').select('*').eq('meal_date', date).order('created_at')
    setMeals(data || [])
  }, [user, date])

  useEffect(() => {
    if (!user) return
    loadMeals()
    supabase.from('foods').select('*').then(({ data }) => setFoods(data || []))
    supabase.from('user_profiles').select('*').maybeSingle().then(({ data }) => setProfile(data))
    setPhotos(loadPhotoMap())
  }, [user]) // eslint-disable-line

  const totals = useMemo(() => sumItems(meals.flatMap(m => m.items || [])), [meals])

  // 增肌目标：热量 = 体重×33×1.1（小盈余），蛋白质 = 体重×1.8g
  const targets = useMemo(() => {
    const w = profile?.weight_kg ? Number(profile.weight_kg) : null
    if (!w) return null
    return { kcal: Math.round(w * 33 * 1.1), protein: Math.round(w * 1.8) }
  }, [profile])

  const deleteMeal = async id => {
    if (!window.confirm('删除这条饮食记录？')) return
    await supabase.from('meals').delete().eq('id', id)
    const map = loadPhotoMap()
    delete map[id]
    savePhotoMap(map)
    setPhotos(map)
    loadMeals()
  }

  const grouped = MEAL_TYPES.map(mt => ({ ...mt, list: meals.filter(m => m.meal_type === mt.id) }))

  const isToday = date === todayStr()

  return (
    <div className="app-shell">
      <div className="page-title">饮食</div>

      {/* 日期切换 */}
      <div className="date-nav">
        <button className="icon-btn" onClick={() => setDate(shiftDate(date, -1))}>‹</button>
        <span style={{ fontWeight: 600 }}>{isToday ? '今天' : date}</span>
        <button className="icon-btn" onClick={() => setDate(shiftDate(date, 1))} disabled={isToday}>›</button>
      </div>

      {/* 今日汇总 */}
      <div className="card">
        <div className="card-title">
          <span>今日摄入</span>
          {targets ? (
            <span className="muted">{Math.round(totals.kcal)} / {targets.kcal} kcal</span>
          ) : (
            <button className="link-btn" onClick={() => setProfileOpen(true)}>设置体重看目标 ›</button>
          )}
        </div>
        {targets && (
          <>
            <div className="pbar"><i style={{ width: `${Math.min(100, totals.kcal / targets.kcal * 100)}%`, background: totals.kcal > targets.kcal * 1.15 ? 'var(--accent)' : 'var(--primary)' }} /></div>
            <div className="macro-row">
              <div className="macro">
                <span>蛋白质 {Math.round(totals.p)}g / {targets.protein}g</span>
                <div className="pbar pbar-sm"><i style={{ width: `${Math.min(100, totals.p / targets.protein * 100)}%` }} /></div>
              </div>
              <div className="macro">
                <span>碳水 {Math.round(totals.c)}g ｜ 脂肪 {Math.round(totals.f)}g</span>
              </div>
            </div>
          </>
        )}
        {!targets && <div className="hint">记录体重后，这里会显示增肌目标（热量小盈余 + 蛋白质 1.8g/kg）的每日进度。</div>}
      </div>

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => setSheetOpen(true)}>＋ 记录一餐</button>

      {grouped.map(g => (
        <div className="card" key={g.id}>
          <div className="card-title"><span>{g.label}</span><span className="muted">{sumItems(g.list.flatMap(m => m.items || [])).kcal} kcal</span></div>
          {g.list.length === 0 && <div className="hint">未记录</div>}
          {g.list.map(m => {
            const s = sumItems(m.items || [])
            return (
              <div className="meal-item" key={m.id}>
                {photos[m.id]?.url && <img className="meal-photo" src={photos[m.id].url} alt="餐食照片" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="meal-note">{m.note || '（无备注）'}</div>
                  <div className="hint">{(m.items || []).map(it => `${it.name}${it.grams}g`).join(' · ')}</div>
                  <div className="hint">{s.kcal} kcal ｜ 蛋白 {Math.round(s.p)}g ｜ 碳水 {Math.round(s.c)}g ｜ 脂肪 {Math.round(s.f)}g</div>
                </div>
                <button className="icon-btn" onClick={() => deleteMeal(m.id)}>✕</button>
              </div>
            )
          })}
        </div>
      ))}

      {sheetOpen && (
        <AddMealSheet
          foods={foods}
          defaultType={(() => {
            const h = new Date().getHours()
            if (h < 10) return 'breakfast'
            if (h < 14) return 'lunch'
            if (h < 21) return 'dinner'
            return 'snack'
          })()}
          onClose={() => setSheetOpen(false)}
          onSave={async data => {
            const { photo, meal_type, note, items, kcal, protein, carbs, fat } = data
            const { data: saved, error } = await supabase
              .from('meals')
              .insert({ user_id: user.id, meal_date: date, meal_type, note, items, kcal, protein, carbs, fat })
              .select()
              .single()
            if (error) throw error
            if (photo) {
              const map = loadPhotoMap()
              map[saved.id] = { url: photo, ts: Date.now() }
              savePhotoMap(map)
              setPhotos({ ...map })
            }
            loadMeals()
          }}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSave={async p => {
            let error
            if (profile) {
              ({ error } = await supabase.from('user_profiles').update(p).eq('id', profile.id))
            } else {
              ({ error } = await supabase.from('user_profiles').insert({ user_id: user.id, ...p }))
            }
            if (error) throw new Error(error.message)
            const { data, error: selErr } = await supabase.from('user_profiles').select('*').maybeSingle()
            if (selErr) throw new Error(selErr.message)
            setProfile(data)
          }}
        />
      )}
    </div>
  )
}

// ---------- 记录一餐（底部弹层） ----------
function AddMealSheet({ foods, defaultType, onClose, onSave }) {
  const fileRef = useRef(null)
  const [mealType, setMealType] = useState(defaultType)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState('')
  const [items, setItems] = useState([])
  const [unmatched, setUnmatched] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const doParse = () => {
    setErr('')
    const { items, unmatched } = parseMealText(note, foods)
    setItems(items)
    setUnmatched(unmatched)
    if (!items.length) setErr('没有识别到食物。试试「鸡蛋2个 牛奶一杯 米饭一碗」这样写，或先点击下方设置体重。')
  }

  const setGrams = (i, grams) => setItems(prev => {
    const g = Math.max(0, Number(grams) || 0)
    const it = prev[i]
    return prev.map((x, j) => j !== i ? x : { ...makeItem({ name: it.name, kcal: it.kcal100, protein: it.p100, carbs: it.c100, fat: it.f100, unit_grams: 100 }, g) })
  })

  const total = sumItems(items)

  const save = async () => {
    if (!items.length) { setErr('请先点击「估算热量」并确认食物明细'); return }
    setBusy(true)
    try {
      const s = sumItems(items)
      await onSave({
        meal_type: mealType, note: note.trim() || null, items,
        kcal: s.kcal, protein: s.p, carbs: s.c, fat: s.f,
        photo: photo || null,
      })
      onClose()
    } catch (e) {
      setErr(e.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="card-title"><span>记录一餐</span><button className="icon-btn" onClick={onClose}>✕</button></div>

        <div className="chip-row">
          {MEAL_TYPES.map(mt => (
            <button key={mt.id} className={'chip' + (mealType === mt.id ? ' active' : '')} onClick={() => setMealType(mt.id)}>{mt.label}</button>
          ))}
        </div>

        <div className="field">
          <label>吃了什么（一句话）</label>
          <textarea rows={2} placeholder="如：鸡蛋2个 牛奶一杯 全麦面包2片" value={note} onChange={e => setNote(e.target.value)} />
        </div>

        <div className="field">
          <label>拍照（可选，仅本设备临时保存，不上传云端）</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" style={{ width: 'auto', padding: '8px 14px' }} onClick={() => fileRef.current?.click()}>📷 拍照/选图</button>
            {photo && (
              <>
                <img src={photo} alt="预览" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                <button className="link-btn danger" onClick={() => setPhoto('')}>移除</button>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) compressImage(f, setPhoto) }} />
        </div>

        <button className="btn btn-ghost" onClick={doParse}>⚡ 估算热量</button>

        {items.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="hint" style={{ marginBottom: 6 }}>识别结果（克数可修改）：</div>
            {items.map((it, i) => (
              <div className="set-row" key={i} style={{ gridTemplateColumns: '1fr 90px 70px 32px' }}>
                <span style={{ fontSize: 14 }}>{it.name}</span>
                <input type="number" min="0" value={it.grams} onChange={e => setGrams(i, e.target.value)} />
                <span className="hint" style={{ textAlign: 'center' }}>{it.kcal}kcal</span>
                <button className="icon-btn" onClick={() => setItems(prev => prev.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="pr-line" style={{ marginTop: 8 }}>
              合计约 <b>{total.kcal} kcal</b> ｜ 蛋白 {Math.round(total.p)}g · 碳水 {Math.round(total.c)}g · 脂肪 {Math.round(total.f)}g
            </div>
          </div>
        )}

        {unmatched.length > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>未识别：{unmatched.join('、')}（食物库暂无，其热量未计入）</div>
        )}

        {err && <div className="banner banner-error" style={{ marginTop: 10 }}>{err}</div>}

        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save} disabled={busy}>{busy ? '保存中…' : '保存这一餐'}</button>
      </div>
    </div>
  )
}

// ---------- 体重设置（底部弹层） ----------
function ProfileSheet({ profile, onClose, onSave }) {
  const [weight, setWeight] = useState(profile?.weight_kg ? String(profile.weight_kg) : '')
  const [activity, setActivity] = useState(profile?.activity ? String(profile.activity) : '1.55')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="card-title"><span>身体数据</span><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="field">
          <label>体重（kg）</label>
          <input type="number" min="20" max="300" step="0.1" placeholder="如 70" value={weight} onChange={e => setWeight(e.target.value)} />
        </div>
        <div className="field">
          <label>活动水平（用于估算每日消耗）</label>
          <select value={activity} onChange={e => setActivity(e.target.value)}>
            <option value="1.375">久坐为主，每周训练 1~2 次</option>
            <option value="1.55">中等活动，每周训练 3~5 次</option>
            <option value="1.725">高强度，每周训练 6~7 次或体力工作</option>
          </select>
        </div>
        <div className="hint" style={{ marginBottom: 12 }}>
          目标按增肌塑形计算：每日热量 = 体重×33×活动系数×1.1（约10%盈余），蛋白质 = 1.8g/kg。后续在「我的」页面可完善更多身体数据。
        </div>
        {err && <div className="banner banner-error">{err}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={async () => {
          const w = Number(weight)
          if (!(w >= 20 && w <= 300)) { setErr('请填写有效体重'); return }
          setBusy(true)
          try {
            await onSave({ weight_kg: w, activity: Number(activity), goal: 'muscle_gain' })
            onClose()
          } catch (e) { setErr(e.message || '保存失败') } finally { setBusy(false) }
        }}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </div>
  )
}
