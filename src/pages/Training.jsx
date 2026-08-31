import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const MUSCLES = [
  { id: 'chest', label: '胸' },
  { id: 'back', label: '背' },
  { id: 'legs', label: '腿' },
  { id: 'shoulders', label: '肩' },
  { id: 'arms', label: '臂' },
  { id: 'core', label: '核心' },
]
const mgLabel = id => (MUSCLES.find(m => m.id === id) || {}).label || id

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

// 计算每个动作的「上次成绩」与「历史最好」（按估算1RM）
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
    let best = null
    for (const s of sets) {
      const e1 = Number(s.weight) * (1 + Number(s.reps) / 30)
      if (!best || e1 > best.e1) best = { ...s, e1 }
    }
    stats[exId] = { last: { date: lastDate, sets: lastSets }, best }
  }
  return stats
}

export default function Training() {
  const { user } = useAuth()
  const [view, setView] = useState('list') // list | session | detail
  const [exercises, setExercises] = useState([])
  const [workouts, setWorkouts] = useState([])
  const [allSets, setAllSets] = useState([])
  const [draft, setDraft] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    if (!supabase || !user) return
    const [{ data: ex }, { data: wo }, { data: st }] = await Promise.all([
      supabase.from('exercises').select('*').order('name'),
      supabase.from('workouts').select('*').order('workout_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('workout_sets').select('id, workout_id, exercise_id, set_index, reps, weight, workouts(workout_date)'),
    ])
    setExercises(ex || [])
    setWorkouts(wo || [])
    setAllSets((st || []).map(r => ({ ...r, date: r.workouts?.workout_date })))
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

  // 按训练日汇总
  const perWorkout = useMemo(() => {
    const m = {}
    for (const s of allSets) {
      if (!m[s.workout_id]) m[s.workout_id] = { setCount: 0, volume: 0, exIds: new Set() }
      m[s.workout_id].setCount += 1
      m[s.workout_id].volume += Number(s.weight) * Number(s.reps)
      m[s.workout_id].exIds.add(s.exercise_id)
    }
    return m
  }, [allSets])

  // 本周 / 上周统计
  const weekStats = useMemo(() => {
    const thisWeek = weekKey(todayStr())
    const byWeek = {}
    const workoutWeek = {}
    for (const w of workouts) workoutWeek[w.id] = weekKey(w.workout_date)
    for (const s of allSets) {
      const wk = workoutWeek[s.workout_id]
      if (!wk) continue
      if (!byWeek[wk]) byWeek[wk] = { volume: 0, count: new Set() }
      byWeek[wk].volume += Number(s.weight) * Number(s.reps)
      byWeek[wk].count.add(s.workout_id)
    }
    return { thisWeek: byWeek[thisWeek] || { volume: 0, count: new Set() } }
  }, [workouts, allSets])

  const goSession = () => {
    if (!draft) {
      setDraft({ date: todayStr(), title: '', entries: [] })
    }
    setView('session')
  }

  // ---------- 会话编辑 ----------
  const updateDraft = fn => setDraft(d => (d ? fn(d) : d))

  const addExerciseToDraft = ex => {
    const pre = stats[ex.id]?.last?.sets?.[0]
    updateDraft(d => ({
      ...d,
      entries: [...d.entries, {
        exerciseId: ex.id, name: ex.name, muscle: ex.muscle_group,
        sets: [pre ? { reps: String(pre.reps), weight: String(pre.weight) } : { reps: '', weight: '' }],
      }],
    }))
    setPickerOpen(false)
  }

  const addSet = ei => updateDraft(d => ({
    ...d,
    entries: d.entries.map((en, i) => {
      if (i !== ei) return en
      const last = en.sets[en.sets.length - 1]
      return { ...en, sets: [...en.sets, last ? { ...last } : { reps: '', weight: '' }] }
    }),
  }))

  const updateSet = (ei, si, field, val) => updateDraft(d => ({
    ...d,
    entries: d.entries.map((en, i) => i !== ei ? en : ({
      ...en,
      sets: en.sets.map((s, j) => j !== si ? s : { ...s, [field]: val }),
    })),
  }))

  const removeSet = (ei, si) => updateDraft(d => ({
    ...d,
    entries: d.entries.map((en, i) => i !== ei ? en : { ...en, sets: en.sets.filter((_, j) => j !== si) }),
  }))

  const removeEntry = ei => updateDraft(d => ({ ...d, entries: d.entries.filter((_, i) => i !== ei) }))

  const finishWorkout = async () => {
    setError('')
    const entries = (draft?.entries || []).filter(e => e.sets.some(s => Number(s.reps) > 0))
    if (!entries.length) { setError('至少记录一个动作，且每组填写有效次数'); return }
    setBusy(true)
    try {
      const { data: wo, error: e1 } = await supabase
        .from('workouts')
        .insert({ user_id: user.id, workout_date: draft.date, title: draft.title || null })
        .select()
        .single()
      if (e1) throw e1
      const rows = []
      for (const en of entries) {
        en.sets.forEach((s, i) => {
          rows.push({
            user_id: user.id, workout_id: wo.id, exercise_id: en.exerciseId,
            set_index: i + 1, reps: Number(s.reps) || 0, weight: Number(s.weight) || 0,
          })
        })
      }
      const { error: e2 } = await supabase.from('workout_sets').insert(rows)
      if (e2) throw e2
      setDraft(null)
      await loadData()
      setView('list')
    } catch (err) {
      setError(err.message || '保存失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const deleteWorkout = async id => {
    if (!window.confirm('确定删除这次训练记录？删除后无法恢复。')) return
    await supabase.from('workouts').delete().eq('id', id)
    await loadData()
    setView('list')
  }

  // ---------- 渲染 ----------
  if (view === 'session' && draft) {
    return (
      <div className="app-shell">
        <div className="page-title">记录训练</div>
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
        </div>

        {draft.entries.map((en, ei) => {
          const st = stats[en.exerciseId]
          const lastTop = st?.last?.sets?.reduce((a, b) => (Number(b.weight) > Number(a.weight) ? b : a))
          return (
            <div className="card ex-entry" key={en.exerciseId}>
              <div className="ex-entry-head">
                <div>
                  <b>{en.name}</b>
                  <span className="tag" style={{ marginLeft: 8 }}>{mgLabel(en.muscle)}</span>
                </div>
                <button className="icon-btn" onClick={() => removeEntry(ei)} aria-label="删除动作">✕</button>
              </div>
              {st && (
                <div className="pr-line">
                  上次 {fmtDate(st.last.date)}：{st.last.sets.length} 组，最高 {lastTop ? `${lastTop.weight}kg×${lastTop.reps}` : '—'}
                  {st.best && <> ｜ 最佳 {st.best.weight}kg×{st.best.reps}（1RM≈{Math.round(st.best.e1)}kg）</>}
                </div>
              )}
              <div className="set-row set-row-head">
                <span className="idx">组</span><span className="idx">次数</span><span className="idx">重量(kg)</span><span />
              </div>
              {en.sets.map((s, si) => (
                <div className="set-row" key={si}>
                  <span className="idx">{si + 1}</span>
                  <input type="number" inputMode="numeric" min="0" placeholder="0" value={s.reps} onChange={e => updateSet(ei, si, 'reps', e.target.value)} />
                  <input type="number" inputMode="decimal" min="0" step="0.5" placeholder="0" value={s.weight} onChange={e => updateSet(ei, si, 'weight', e.target.value)} />
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
          <button className="btn btn-primary" onClick={finishWorkout} disabled={busy}>{busy ? '保存中…' : '结束训练并保存'}</button>
        </div>

        {pickerOpen && (
          <ExercisePicker
            exercises={exercises}
            user={user}
            onClose={() => setPickerOpen(false)}
            onPick={addExerciseToDraft}
            onCreate={async (name, mg) => {
              const { data, error } = await supabase
                .from('exercises').insert({ user_id: user.id, name, muscle_group: mg }).select().single()
              if (error) { setError(error.message); return }
              setExercises(prev => [...prev, data])
              addExerciseToDraft(data)
            }}
          />
        )}
      </div>
    )
  }

  if (view === 'detail' && detailId) {
    const wo = workouts.find(w => w.id === detailId)
    const sets = allSets.filter(s => s.workout_id === detailId).sort((a, b) => a.set_index - b.set_index)
    const grouped = []
    for (const s of sets) {
      let g = grouped.find(x => x.exId === s.exercise_id)
      if (!g) { g = { exId: s.exercise_id, sets: [] }; grouped.push(g) }
      g.sets.push(s)
    }
    const pw = perWorkout[detailId]
    return (
      <div className="app-shell">
        <div className="page-title">
          <button className="link-btn" onClick={() => setView('list')}>‹ 返回</button>
          {wo ? wo.title || '训练详情' : '训练详情'}
        </div>
        {wo && (
          <div className="card">
            <div className="card-title">
              <span>{wo.workout_date}{wo.title ? ` · ${wo.title}` : ''}</span>
              <button className="link-btn danger" onClick={() => deleteWorkout(wo.id)}>删除</button>
            </div>
            <div className="stat-grid">
              <div className="stat-cell"><div className="num">{grouped.length}</div><div className="lbl">动作数</div></div>
              <div className="stat-cell"><div className="num">{pw ? pw.setCount : 0}</div><div className="lbl">总组数</div></div>
              <div className="stat-cell"><div className="num" style={{ fontSize: 15 }}>{fmtVol(pw ? pw.volume : 0)}</div><div className="lbl">总容量</div></div>
            </div>
          </div>
        )}
        {grouped.map(g => {
          const name = exById[g.exId]?.name || '未知动作'
          const muscle = exById[g.exId]?.muscle_group
          return (
            <div className="card" key={g.exId}>
              <div className="card-title">
                <span>{name} {muscle && <span className="tag">{mgLabel(muscle)}</span>}</span>
                <span className="muted">{g.sets.length} 组</span>
              </div>
              {g.sets.map(s => (
                <div className="log-line" key={s.id}>第 {s.set_index} 组：{s.reps} 次 × {Number(s.weight)} kg</div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // ---------- 列表视图 ----------
  return (
    <div className="app-shell">
      <div className="page-title">训练</div>

      <div className="card">
        <div className="stat-grid">
          <div className="stat-cell"><div className="num">{weekStats.thisWeek.count.size}</div><div className="lbl">本周训练(次)</div></div>
          <div className="stat-cell"><div className="num" style={{ fontSize: 16 }}>{fmtVol(weekStats.thisWeek.volume)}</div><div className="lbl">本周容量</div></div>
          <div className="stat-cell"><div className="num">{exercises.filter(e => e.user_id).length}</div><div className="lbl">自定义动作</div></div>
        </div>
      </div>

      {draft && draft.entries.length > 0 && (
        <div className="banner banner-warn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>有一次进行中的训练草稿（{draft.entries.length} 个动作）</span>
          <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="link-btn" onClick={goSession}>继续</button>
            <button className="link-btn danger" onClick={() => { if (window.confirm('放弃这次训练草稿？')) setDraft(null) }}>放弃</button>
          </span>
        </div>
      )}

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={goSession}>＋ 开始新训练</button>

      <div className="card">
        <div className="card-title"><span>历史记录</span><span className="muted">{workouts.length} 次</span></div>
        {workouts.length === 0 && <div className="empty">还没有训练记录，点击上方按钮开始第一次记录吧</div>}
        {workouts.map(w => {
          const pw = perWorkout[w.id]
          const muscles = pw ? [...new Set([...pw.exIds].map(id => mgLabel(exById[id]?.muscle_group || '')))].join('·') : ''
          return (
            <div className="list-item" key={w.id} onClick={() => { setDetailId(w.id); setView('detail') }}>
              <div>
                <div style={{ fontWeight: 600 }}>{w.workout_date}{w.title ? ` · ${w.title}` : ''}</div>
                <div className="hint">{muscles} ｜ {pw ? pw.setCount : 0} 组 ｜ 容量 {fmtVol(pw ? pw.volume : 0)}</div>
              </div>
              <span className="hint">›</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- 动作选择器（底部弹层） ----------
function ExercisePicker({ exercises, user, onClose, onPick, onCreate }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMg, setNewMg] = useState('chest')
  const [err, setErr] = useState('')

  const list = exercises.filter(e =>
    (filter === 'all' || e.muscle_group === filter) &&
    (!search.trim() || e.name.toLowerCase().includes(search.trim().toLowerCase()))
  )
  const groups = MUSCLES.filter(m => list.some(e => e.muscle_group === m.id))

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

        {groups.map(m => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div className="hint" style={{ margin: '6px 0' }}>{m.label}部</div>
            {list.filter(e => e.muscle_group === m.id).map(e => (
              <div className="list-item" key={e.id} onClick={() => onPick(e)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {e.name}
                  {!e.is_preset && !e.user_id ? null : e.user_id ? <span className="tag">自定义</span> : null}
                </div>
                <span className="hint">＋</span>
              </div>
            ))}
          </div>
        ))}
        {list.length === 0 && <div className="empty">没有匹配的动作，可以在下方创建自定义动作</div>}

        {err && <div className="banner banner-error">{err}</div>}

        {showCreate ? (
          <div className="card" style={{ marginTop: 12, marginBottom: 0 }}>
            <div className="card-title">新建自定义动作</div>
            <div className="field"><label>动作名称</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="如：史密斯窄距卧推" />
            </div>
            <div className="field"><label>肌群</label>
              <select value={newMg} onChange={e => setNewMg(e.target.value)}>
                {MUSCLES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" onClick={() => {
              if (!newName.trim()) { setErr('请填写动作名称'); return }
              setErr('')
              onCreate(newName.trim(), newMg)
              setNewName(''); setShowCreate(false)
            }}>创建并加入本次训练</button>
          </div>
        ) : (
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setShowCreate(true)}>＋ 没找到？创建自定义动作</button>
        )}
      </div>
    </div>
  )
}
