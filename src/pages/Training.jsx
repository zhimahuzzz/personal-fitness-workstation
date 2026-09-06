import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { estimateWorkoutKcal } from '../lib/goals'
import { workoutBurn } from '../lib/dailyBalance'
import { aiEstimateWorkoutKcal } from '../lib/ai'

const MUSCLES = [
  { id: 'chest', label: '胸' },
  { id: 'back', label: '背' },
  { id: 'legs', label: '腿' },
  { id: 'shoulders', label: '肩' },
  { id: 'arms', label: '臂' },
  { id: 'core', label: '核心' },
]
const mgLabel = id => (MUSCLES.find(m => m.id === id) || {}).label || id
// 动作类型：weight=重量型(次数×重量) / reps=自重次数型 / timed=计时型(秒)
const CAT_LABEL = { weight: '重量', reps: '自重', timed: '计时' }

const DRAFT_KEY = 'fwd_workout_draft_v1'
const pad = n => String(n).padStart(2, '0')
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const fmtDate = s => (s ? `${s.slice(5, 7)}/${s.slice(8, 10)}` : '')
const fmtVol = v => (v >= 10000 ? `${(v / 1000).toFixed(1)} 吨` : `${Math.round(v)} kg`)
// 以周一为一周起点
const weekKey = dateStr => {
  const d = new Date(dateStr + 'T00:00:00')
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 计算每个动作的「上次成绩」与历史最好（重量型按估算1RM，自重型按最多次数，计时型按最长秒数）
function computeStats(allSets) {
  const byEx = {}
  for (const s of allSets) {
    if (!byEx[s.exercise_id]) byEx[s.exercise_id] = []
    byEx[s.exercise_id].push(s)
  }
  const stats = {}
  for (const [exId, sets] of Object.entries(byEx)) {
    sets.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.set_index - b.set_index))
    const lastDate = sets[sets.length - 1].date
    const lastSets = sets.filter(s => s.date === lastDate)
    let bestE1 = null, bestReps = 0, bestDur = 0
    for (const s of sets) {
      const w = Number(s.weight) || 0
      if (w > 0 && Number(s.reps) > 0) {
        const e1 = w * (1 + Number(s.reps) / 30)
        if (!bestE1 || e1 > bestE1.e1) bestE1 = { ...s, e1 }
      }
      if (Number(s.reps) > bestReps) bestReps = Number(s.reps)
      if (Number(s.duration_sec || 0) > bestDur) bestDur = Number(s.duration_sec)
    }
    stats[exId] = { last: { date: lastDate, sets: lastSets }, bestE1, bestReps, bestDur }
  }
  return stats
}

// 一组是否有效（按动作类型）
const isValidSet = (s, cat) => cat === 'timed'
  ? Number(s.durationSec) > 0
  : Number(s.reps) > 0

export default function Training() {
  const { user } = useAuth()
  const [view, setView] = useState('list') // list | session
  const [exercises, setExercises] = useState([])
  const [workouts, setWorkouts] = useState([])
  const [allSets, setAllSets] = useState([])
  const [profileW, setProfileW] = useState(null)
  const [draft, setDraft] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aiEst, setAiEst] = useState('') // AI 消耗估算提示

  const loadData = useCallback(async () => {
    if (!supabase || !user) return
    const [{ data: ex }, { data: wo }, { data: st }, { data: prof }] = await Promise.all([
      supabase.from('exercises').select('*').order('name'),
      supabase.from('workouts').select('*').order('workout_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('workout_sets').select('id, workout_id, exercise_id, set_index, reps, weight, duration_sec, workouts(workout_date)'),
      supabase.from('user_profiles').select('weight_kg').maybeSingle(),
    ])
    setExercises(ex || [])
    setWorkouts(wo || [])
    setAllSets((st || []).map(r => ({ ...r, date: r.workouts?.workout_date })))
    setProfileW(prof?.weight_kg || null)
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  // 草稿：恢复 / 持久化（刷新页面不丢进行中的训练）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) setDraft(JSON.parse(raw))
    } catch { /* 忽略损坏草稿 */ }
  }, [])
  useEffect(() => {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else localStorage.removeItem(DRAFT_KEY)
  }, [draft])

  const stats = useMemo(() => computeStats(allSets), [allSets])
  const exById = useMemo(() => Object.fromEntries(exercises.map(e => [e.id, e])), [exercises])
  // 动作类型兜底（旧草稿/旧数据没有 category 时查动作库）
  const catOf = useCallback(en => en.category || exById[en.exerciseId]?.category || 'weight', [exById])

  // 按训练日汇总（容量只计重量型动作）
  const perWorkout = useMemo(() => {
    const m = {}
    for (const s of allSets) {
      if (!m[s.workout_id]) m[s.workout_id] = { setCount: 0, volume: 0, exIds: new Set() }
      m[s.workout_id].setCount += 1
      const cat = exById[s.exercise_id]?.category || 'weight'
      if (cat === 'weight') m[s.workout_id].volume += Number(s.weight) * Number(s.reps)
      m[s.workout_id].exIds.add(s.exercise_id)
    }
    return m
  }, [allSets, exById])

  // 本周统计（容量只计重量型）
  const weekStats = useMemo(() => {
    const thisWeek = weekKey(todayStr())
    const byWeek = {}
    const workoutWeek = {}
    for (const w of workouts) workoutWeek[w.id] = weekKey(w.workout_date)
    for (const s of allSets) {
      const wk = workoutWeek[s.workout_id]
      if (!wk) continue
      if (!byWeek[wk]) byWeek[wk] = { volume: 0, count: new Set() }
      const cat = exById[s.exercise_id]?.category || 'weight'
      if (cat === 'weight') byWeek[wk].volume += Number(s.weight) * Number(s.reps)
      byWeek[wk].count.add(s.workout_id)
    }
    return { thisWeek: byWeek[thisWeek] || { volume: 0, count: new Set() } }
  }, [workouts, allSets, exById])

  // 最近使用的动作（按最近训练日倒序取前 6 个），加动作时置顶展示
  const recentIds = useMemo(() => {
    const byDate = {}
    for (const s of allSets) {
      if (!byDate[s.exercise_id] || byDate[s.exercise_id] < s.date) byDate[s.exercise_id] = s.date
    }
    return Object.entries(byDate)
      .sort((a, b) => (a[1] < b[1] ? 1 : -1))
      .slice(0, 6)
      .map(([id]) => id)
  }, [allSets])

  // 把一条已保存的训练载入编辑器
  const loadToDraft = useCallback(wo => {
    const sets = allSets
      .filter(s => s.workout_id === wo.id)
      .sort((a, b) => a.set_index - b.set_index)
    const entries = []
    for (const s of sets) {
      let en = entries.find(e => e.exerciseId === s.exercise_id)
      if (!en) {
        const ex = exById[s.exercise_id]
        en = {
          exerciseId: s.exercise_id, name: ex?.name || '未知动作',
          muscle: ex?.muscle_group, category: ex?.category || 'weight', sets: [],
        }
        entries.push(en)
      }
      en.sets.push({
        id: s.id,
        reps: s.reps ? String(s.reps) : '',
        weight: Number(s.weight) ? String(s.weight) : '',
        durationSec: s.duration_sec ? String(s.duration_sec) : '',
      })
    }
    return {
      id: wo.id, date: wo.workout_date, title: wo.title || '',
      durationMin: wo.duration_min ? String(wo.duration_min) : '',
      entries,
    }
  }, [allSets, exById])

  // 打开训练：不传 wo = 开始新训练（当天已有则自动载入）；传 wo = 直接进入该天编辑
  // 点列表里的任意一天都直接进编辑器，改数据一步到位
  const goSession = wo => {
    if (wo) {
      // 有未保存的其他草稿时先确认，防止误替换
      if (draft && draft.id !== wo.id && draft.entries.length > 0 &&
          !window.confirm('当前有未保存的训练草稿，打开这条记录会替换草稿，继续？')) return
      setDraft(loadToDraft(wo))
    } else if (!draft) {
      const todayWo = workouts.find(w => w.workout_date === todayStr())
      setDraft(todayWo ? loadToDraft(todayWo) : { date: todayStr(), title: '', durationMin: '', entries: [] })
    }
    setView('session')
  }

  // ---------- 会话编辑 ----------
  const updateDraft = fn => setDraft(d => (d ? fn(d) : d))

  const addExerciseToDraft = ex => {
    updateDraft(d => {
      if (d.entries.some(e => e.exerciseId === ex.id)) return d // 防重复添加
      const cat = ex.category || 'weight'
      const pre = stats[ex.id]?.last?.sets?.[0]
      let first
      if (cat === 'timed') {
        first = { reps: '', weight: '', durationSec: pre?.duration_sec ? String(pre.duration_sec) : '' }
      } else if (cat === 'reps') {
        first = { reps: pre ? String(pre.reps || '') : '', weight: '', durationSec: '' }
      } else {
        first = pre
          ? { reps: String(pre.reps ?? ''), weight: pre.weight != null ? String(pre.weight) : '', durationSec: '' }
          : { reps: '', weight: '', durationSec: '' }
      }
      return {
        ...d,
        entries: [...d.entries, { exerciseId: ex.id, name: ex.name, muscle: ex.muscle_group, category: cat, sets: [first] }],
      }
    })
    setPickerOpen(false)
  }

  const addSet = ei => updateDraft(d => ({
    ...d,
    entries: d.entries.map((en, i) => {
      if (i !== ei) return en
      const last = en.sets[en.sets.length - 1]
      return { ...en, sets: [...en.sets, last ? { ...last, id: null } : { reps: '', weight: '', durationSec: '' }] }
    }),
  }))

  const updateSet = (ei, si, field, val) => updateDraft(d => ({
    ...d,
    entries: d.entries.map((en, i) => i !== ei ? en : ({
      ...en,
      sets: en.sets.map((s, j) => j !== si ? s : { ...s, [field]: val, id: s.id ?? null }),
    })),
  }))

  const removeSet = (ei, si) => updateDraft(d => ({
    ...d,
    entries: d.entries.map((en, i) => i !== ei ? en : { ...en, sets: en.sets.filter((_, j) => j !== si) }),
  }))

  const removeEntry = ei => updateDraft(d => ({ ...d, entries: d.entries.filter((_, i) => i !== ei) }))

  const finishWorkout = async () => {
    setError('')
    // 清理出有效条目
    const entries = (draft?.entries || [])
      .map(en => ({ ...en, cat: catOf(en), sets: en.sets.filter(s => isValidSet(s, catOf(en))) }))
      .filter(en => en.sets.length)
    if (!entries.length) { setError('至少记录一个动作，且每组填写有效数值'); return }
    setBusy(true)
    try {
      let woId = draft.id
      // 一天一条：新建时若同日已有训练，自动合并进那条记录
      if (!woId) {
        const sameDay = workouts.find(w => w.workout_date === draft.date)
        if (sameDay) {
          woId = sameDay.id
          const existing = allSets.filter(s => s.workout_id === sameDay.id)
          for (const s of existing) {
            const loaded = {
              id: s.id,
              reps: s.reps ? String(s.reps) : '',
              weight: Number(s.weight) ? String(s.weight) : '',
              durationSec: s.duration_sec ? String(s.duration_sec) : '',
            }
            const en = entries.find(e => e.exerciseId === s.exercise_id)
            if (en) en.sets.push(loaded)
            else {
              const ex = exById[s.exercise_id]
              entries.push({
                exerciseId: s.exercise_id, name: ex?.name || '未知动作',
                muscle: ex?.muscle_group, category: ex?.category || 'weight', cat: ex?.category || 'weight',
                sets: [loaded],
              })
            }
          }
        }
      }
      const woPayload = {
        workout_date: draft.date,
        title: draft.title || null,
        duration_min: draft.durationMin ? Number(draft.durationMin) : null,
      }
      let woIdFinal = woId
      if (woIdFinal) {
        // 编辑：更新训练日信息，组数据全量重建（删旧插新，数据量小且简单可靠）
        const { error: e0 } = await supabase.from('workouts').update(woPayload).eq('id', woIdFinal)
        if (e0) throw e0
        const { error: e1 } = await supabase.from('workout_sets').delete().eq('workout_id', woIdFinal)
        if (e1) throw e1
      } else {
        const { data: wo, error: e1 } = await supabase
          .from('workouts')
          .insert({ user_id: user.id, ...woPayload })
          .select().single()
        if (e1) throw e1
        woIdFinal = wo.id
      }
      const rows = []
      for (const en of entries) {
        en.sets.forEach((s, i) => {
          rows.push({
            user_id: user.id, workout_id: woIdFinal, exercise_id: en.exerciseId,
            set_index: i + 1,
            reps: Number(s.reps) || 0,
            weight: en.cat === 'weight' ? (Number(s.weight) || 0) : 0,
            duration_sec: en.cat === 'timed' ? (Number(s.durationSec) || 0) : null,
          })
        })
      }
      if (rows.length) {
        const { error: e2 } = await supabase.from('workout_sets').insert(rows)
        if (e2) throw e2
      }
      setDraft(null)
      await loadData()
      setView('list')
      // 保存成功后 AI 按动作明细估算消耗，写入 workouts.est_kcal（失败不影响保存，展示时回退公式）
      estimateAndSaveKcal(woIdFinal, entries, draft.durationMin)
    } catch (err) {
      setError(err.message || '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const deleteWorkout = async id => {
    if (!window.confirm('确定删除这次训练记录？删除后无法恢复。')) return
    await supabase.from('workouts').delete().eq('id', id)
    if (draft?.id === id) setDraft(null)
    await loadData()
    setView('list')
  }

  // AI 估算训练净消耗并存库（后台执行，不阻塞界面）
  const estimateAndSaveKcal = (woId, entries, durationMin) => {
    setAiEst('🤖 AI 正在按动作明细估算本次训练消耗…')
    const items = entries.map(en => ({
      name: en.name,
      sets: en.sets.map(s => ({
        reps: Number(s.reps) || 0,
        weight: en.cat === 'weight' ? (Number(s.weight) || 0) : 0,
        durationSec: en.cat === 'timed' ? (Number(s.durationSec) || 0) : 0,
      })),
    }))
    aiEstimateWorkoutKcal({ weightKg: profileW, durationMin: Number(durationMin) || 0, items })
      .then(async ({ kcal }) => {
        if (kcal > 0) {
          await supabase.from('workouts').update({ est_kcal: kcal }).eq('id', woId)
          await loadData()
          setAiEst(`🤖 AI 估算本次训练净消耗 ≈ ${kcal} kcal，已计入今日热量`)
        } else {
          setAiEst('')
        }
      })
      .catch(() => setAiEst('🤖 AI 消耗估算暂时不可用（高峰期限流），已用公式估算代替'))
  }

  // ---------- 渲染 ----------
  if (view === 'session' && draft) {
    // 本次训练实时统计（组数/容量/估算消耗）
    const draftSetCount = draft.entries.reduce((s, en) => s + en.sets.filter(x => isValidSet(x, catOf(en))).length, 0)
    const draftVolume = draft.entries.reduce((s, en) => {
      if (catOf(en) !== 'weight') return s
      return s + en.sets.reduce((v, x) => v + (Number(x.reps) || 0) * (Number(x.weight) || 0), 0)
    }, 0)
    const draftKcal = draft.id
      ? workoutBurn(workouts.find(w => w.id === draft.id), draftSetCount, profileW)
      : { kcal: estimateWorkoutKcal({ setCount: draftSetCount, durationMin: draft.durationMin || null, weightKg: profileW }), source: 'formula' }
    return (
      <div className="app-shell">
        <div className="page-title">
          <button className="link-btn" onClick={() => setView('list')}>‹ 返回</button>
          {draft.id ? '编辑训练' : '记录训练'}
        </div>
        {draft.id && (
          <div className="banner banner-warn" style={{ marginBottom: 12 }}>
            正在编辑 {draft.date} 的训练记录，保存后原记录会被更新
          </div>
        )}
        {error && <div className="banner banner-error">{error}</div>}
        <div className="card">
          <div className="field-row2">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>日期</label>
              <input type="date" value={draft.date} onChange={e => updateDraft(d => ({ ...d, date: e.target.value }))} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>名称（可选）</label>
              <input type="text" placeholder="如：胸+三头" value={draft.title} onChange={e => updateDraft(d => ({ ...d, title: e.target.value }))} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>训练时长（分钟，可选）</label>
            <input type="number" inputMode="numeric" min="0" placeholder="不填则按组数自动估算" value={draft.durationMin} onChange={e => updateDraft(d => ({ ...d, durationMin: e.target.value }))} />
          </div>
        </div>

        {draft.entries.length > 0 && (
          <div className="card">
            <div className="stat-grid">
              <div className="stat-cell"><div className="num">{draft.entries.length}</div><div className="lbl">动作</div></div>
              <div className="stat-cell"><div className="num">{draftSetCount}</div><div className="lbl">总组数</div></div>
              <div className="stat-cell"><div className="num" style={{ fontSize: 15 }}>{fmtVol(draftVolume)}</div><div className="lbl">总容量</div></div>
              <div className="stat-cell"><div className="num" style={{ fontSize: 15 }}>{draftKcal.kcal > 0 ? `≈${draftKcal.kcal}` : '—'}</div><div className="lbl">消耗kcal{draftKcal.source === 'ai' ? ' 🤖' : ''}</div></div>
            </div>
          </div>
        )}

        {draft.entries.map((en, ei) => {
          const cat = catOf(en)
          const st = stats[en.exerciseId]
          const lastTop = st?.last?.sets?.reduce((a, b) => (Number(b.weight) > Number(a.weight) ? b : a))
          return (
            <div className="card ex-entry" key={en.exerciseId}>
              <div className="ex-entry-head">
                <div>
                  <b>{en.name}</b>
                  <span className="tag" style={{ marginLeft: 8 }}>{mgLabel(en.muscle)}</span>
                  {cat !== 'weight' && <span className="tag" style={{ marginLeft: 4 }}>{CAT_LABEL[cat]}</span>}
                </div>
                <button className="icon-btn" onClick={() => removeEntry(ei)} aria-label="删除动作">✕</button>
              </div>
              {st && (
                <div className="pr-line">
                  {cat === 'weight' ? (
                    <>上次 {fmtDate(st.last.date)}：{st.last.sets.length} 组，最高 {lastTop ? `${lastTop.weight}kg×${lastTop.reps}` : '—'}
                      {st.bestE1 && <> ｜ 最佳 {st.bestE1.weight}kg×{st.bestE1.reps}（1RM≈{Math.round(st.bestE1.e1)}kg）</>}</>
                  ) : cat === 'reps' ? (
                    <>上次 {fmtDate(st.last.date)}：{st.last.sets.length} 组，最多 {Math.max(...st.last.sets.map(s => Number(s.reps) || 0))} 次{st.bestReps ? ` ｜ 历史最多 ${st.bestReps} 次` : ''}</>
                  ) : (
                    <>上次 {fmtDate(st.last.date)}：{st.last.sets.length} 组，最长 {Math.max(...st.last.sets.map(s => Number(s.duration_sec) || 0))} 秒{st.bestDur ? ` ｜ 历史最长 ${st.bestDur} 秒` : ''}</>
                  )}
                </div>
              )}
              <div className={'set-row set-row-head' + (cat === 'weight' ? '' : ' cols3')}>
                {cat === 'weight'
                  ? <><span className="idx">组</span><span className="idx">次数</span><span className="idx">重量(kg)</span><span /></>
                  : <><span className="idx">组</span><span className="idx">{cat === 'timed' ? '秒数' : '次数'}</span><span /></>}
              </div>
              {en.sets.map((s, si) => (
                <div className={'set-row' + (cat === 'weight' ? '' : ' cols3')} key={si}>
                  <span className="idx">{si + 1}</span>
                  {cat === 'timed' ? (
                    <input type="number" inputMode="numeric" min="0" placeholder="秒" value={s.durationSec} onChange={e => updateSet(ei, si, 'durationSec', e.target.value)} />
                  ) : (
                    <input type="number" inputMode="numeric" min="0" placeholder="0" value={s.reps} onChange={e => updateSet(ei, si, 'reps', e.target.value)} />
                  )}
                  {cat === 'weight' && (
                    <input type="number" inputMode="decimal" min="0" step="0.5" placeholder="0" value={s.weight} onChange={e => updateSet(ei, si, 'weight', e.target.value)} />
                  )}
                  <button className="icon-btn" onClick={() => removeSet(ei, si)} aria-label="删除本组">✕</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => addSet(ei)}>＋ 加一组</button>
            </div>
          )
        })}

        <button className="btn btn-ghost" onClick={() => setPickerOpen(true)}>＋ 添加动作</button>

        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => setView('list')}>暂存离开</button>
          <button className="btn btn-primary" onClick={finishWorkout} disabled={busy}>{busy ? '保存中…' : draft.id ? '保存修改' : '结束训练并保存'}</button>
        </div>
        {draft.id && (
          <button className="link-btn danger" style={{ marginTop: 14 }} onClick={() => deleteWorkout(draft.id)}>删除这天的全部记录</button>
        )}

        {pickerOpen && (
          <ExercisePicker
            exercises={exercises}
            user={user}
            recentIds={recentIds}
            onClose={() => setPickerOpen(false)}
            onPick={addExerciseToDraft}
            onCreate={async (name, mg, cat) => {
              const { data, error } = await supabase
                .from('exercises').insert({ user_id: user.id, name, muscle_group: mg, category: cat }).select().single()
              if (error) { setError(error.message); return }
              setExercises(prev => [...prev, data])
              addExerciseToDraft(data)
            }}
          />
        )}
      </div>
    )
  }

  // ---------- 列表视图 ----------
  return (
    <div className="app-shell">
      <div className="page-title">训练</div>

      <div className="card">
        <div className="stat-grid">
          <div className="stat-cell"><div className="num">{weekStats.thisWeek.count.size}</div><div className="lbl">本周训练(天)</div></div>
          <div className="stat-cell"><div className="num" style={{ fontSize: 16 }}>{fmtVol(weekStats.thisWeek.volume)}</div><div className="lbl">本周容量</div></div>
          <div className="stat-cell"><div className="num">{exercises.filter(e => e.user_id).length}</div><div className="lbl">自定义动作</div></div>
        </div>
      </div>

      {aiEst && <div className="banner banner-warn">{aiEst}</div>}

      {draft && draft.entries.length > 0 && (
        <div className="banner banner-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>有一次进行中的训练草稿（{draft.entries.length} 个动作）</span>
          <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="link-btn" onClick={() => setView('session')}>继续</button>
            <button className="link-btn danger" onClick={() => { if (window.confirm('放弃这次训练草稿？')) setDraft(null) }}>放弃</button>
          </span>
        </div>
      )}

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => goSession()}>
        {workouts.some(w => w.workout_date === todayStr()) ? '✏️ 继续记录今天的训练' : '＋ 开始新训练'}
      </button>

      <div className="card">
        <div className="card-title"><span>历史记录</span><span className="muted">{workouts.length} 天</span></div>
        {workouts.length === 0 && <div className="empty">还没有训练记录，点击上方按钮开始第一次记录吧</div>}
        {workouts.map(w => {
          const pw = perWorkout[w.id]
          const muscles = pw ? [...new Set([...pw.exIds].map(id => mgLabel(exById[id]?.muscle_group || '')))].join('·') : ''
          const burn = workoutBurn(w, pw ? pw.setCount : 0, profileW)
          return (
            <div className="list-item" key={w.id} onClick={() => goSession(w)}>
              <div>
                <div style={{ fontWeight: 600 }}>{w.workout_date}{w.title ? ` · ${w.title}` : ''}</div>
                <div className="hint">{muscles} ｜ {pw ? pw.setCount : 0} 组 ｜ 容量 {fmtVol(pw ? pw.volume : 0)}{burn.kcal > 0 ? ` ｜ ≈${burn.kcal} kcal${burn.source === 'ai' ? '🤖' : ''}` : ''}</div>
              </div>
              <span className="hint">改 ›</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- 动作选择器（底部弹层） ----------
function ExercisePicker({ exercises, user, recentIds = [], onClose, onPick, onCreate }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMg, setNewMg] = useState('chest')
  const [newCat, setNewCat] = useState('weight')
  const [err, setErr] = useState('')

  const kw = search.trim().toLowerCase()
  const list = exercises.filter(e =>
    (filter === 'all' || e.muscle_group === filter) &&
    (!kw || e.name.toLowerCase().includes(kw))
  )
  const groups = MUSCLES.filter(m => list.some(e => e.muscle_group === m.id))
  // 最近使用（无搜索、全部筛选时置顶）
  const recent = recentIds
    .map(id => exercises.find(e => e.id === id))
    .filter(Boolean)
    .filter(e => filter === 'all' || e.muscle_group === filter)
    .filter(e => !kw || e.name.toLowerCase().includes(kw))
    .slice(0, 5)

  const openCreate = name => {
    setNewName(name || '')
    setShowCreate(true)
    setErr('')
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="card-title"><span>选择动作</span><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="field">
          <input type="text" placeholder="搜索动作名称…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        </div>
        <div className="chip-row">
          <button className={'chip' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>全部</button>
          {MUSCLES.map(m => (
            <button key={m.id} className={'chip' + (filter === m.id ? ' active' : '')} onClick={() => setFilter(m.id)}>{m.label}</button>
          ))}
        </div>

        {recent.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div className="hint" style={{ margin: '6px 0' }}>最近使用</div>
            {recent.map(e => (
              <div className="list-item" key={'r-' + e.id} onClick={() => onPick(e)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {e.name}
                  {e.category && e.category !== 'weight' && <span className="tag">{CAT_LABEL[e.category]}</span>}
                </div>
                <span className="hint">＋</span>
              </div>
            ))}
          </div>
        )}

        {groups.map(m => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div className="hint" style={{ margin: '6px 0' }}>{m.label}部</div>
            {list.filter(e => e.muscle_group === m.id).map(e => (
              <div className="list-item" key={e.id} onClick={() => onPick(e)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {e.name}
                  {e.category && e.category !== 'weight' && <span className="tag">{CAT_LABEL[e.category]}</span>}
                  {e.user_id && <span className="tag">自定义</span>}
                </div>
                <span className="hint">＋</span>
              </div>
            ))}
          </div>
        ))}
        {list.length === 0 && (
          kw
            ? <div className="empty" style={{ marginBottom: 8 }}>没有匹配「{search.trim()}」的动作</div>
            : <div className="empty" style={{ marginBottom: 8 }}>没有匹配的动作，可以在下方创建自定义动作</div>
        )}

        {err && <div className="banner banner-error">{err}</div>}

        {showCreate ? (
          <div className="card" style={{ marginTop: 12, marginBottom: 0 }}>
            <div className="card-title">新建自定义动作</div>
            <div className="field"><label>动作名称</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="如：史密斯窄距卧推" autoFocus />
            </div>
            <div className="field-row2">
              <div className="field"><label>肌群</label>
                <select value={newMg} onChange={e => setNewMg(e.target.value)}>
                  {MUSCLES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div className="field"><label>记录方式</label>
                <select value={newCat} onChange={e => setNewCat(e.target.value)}>
                  <option value="weight">重量型（次数×重量）</option>
                  <option value="reps">自重次数（如悬垂举腿）</option>
                  <option value="timed">计时（秒，如平板支撑）</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => {
              if (!newName.trim()) { setErr('请填写动作名称'); return }
              setErr('')
              onCreate(newName.trim(), newMg, newCat)
              setNewName(''); setShowCreate(false)
            }}>创建并加入本次训练</button>
          </div>
        ) : (
          kw && list.length === 0 ? (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => openCreate(search.trim())}>
              ＋ 创建自定义动作「{search.trim()}」
            </button>
          ) : (
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => openCreate('')}>＋ 没找到？创建自定义动作</button>
          )
        )}
      </div>
    </div>
  )
}
