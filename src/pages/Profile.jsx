import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { computeTargets, EXPERIENCE_OPTIONS, ACTIVITY_OPTIONS } from '../lib/goals'

export default function Profile() {
  const { user, signOut } = useAuth()
  const [form, setForm] = useState(null) // null=加载中
  const [profileId, setProfileId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!supabase || !user) return
    const { data } = await supabase.from('user_profiles').select('*').maybeSingle()
    setProfileId(data?.id || null)
    setForm({
      weight_kg: data?.weight_kg ?? '',
      target_weight_kg: data?.target_weight_kg ?? '',
      height_cm: data?.height_cm ?? '',
      age: data?.age ?? '',
      gender: data?.gender || 'male',
      activity: data?.activity ?? 1.55,
      experience: data?.experience || 'beginner',
      weekly_days: data?.weekly_days ?? 4,
    })
  }, [user])

  useEffect(() => { load() }, [load])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.weight_kg) { setErr('至少填写当前体重，才能计算每日热量和蛋白质目标'); setMsg(''); return }
    setBusy(true); setErr(''); setMsg('')
    const payload = {
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      target_weight_kg: form.target_weight_kg ? Number(form.target_weight_kg) : null,
      height_cm: form.height_cm ? Number(form.height_cm) : null,
      age: form.age ? Number(form.age) : null,
      gender: form.gender,
      activity: Number(form.activity),
      experience: form.experience,
      weekly_days: Number(form.weekly_days) || 4,
      goal: 'muscle_gain',
      updated_at: new Date().toISOString(),
    }
    try {
      let error
      if (profileId) {
        ({ error } = await supabase.from('user_profiles').update(payload).eq('id', profileId))
      } else {
        ({ error } = await supabase.from('user_profiles').insert({ user_id: user.id, ...payload }))
      }
      if (error) throw error
      setMsg('已保存 ✓ 仪表盘和饮食页的目标已同步更新')
      load()
    } catch (e) {
      setErr('保存失败：' + (e.message || '未知错误'))
    } finally {
      setBusy(false)
    }
  }

  const targets = form?.weight_kg ? computeTargets({ weight_kg: form.weight_kg }) : null

  return (
    <div className="app-shell">
      <div className="page-title">我的</div>

      <div className="card">
        <div className="card-title"><span>账号</span></div>
        <div className="muted">{user?.email || '未登录'}</div>
      </div>

      <div className="card">
        <div className="card-title"><span>目标设定</span><span className="chip active" style={{ cursor: 'default' }}>增肌塑形</span></div>
        {!form ? (
          <div className="empty">加载中…</div>
        ) : (
          <>
            <div className="field-row2">
              <div className="field">
                <label>当前体重（kg）*</label>
                <input type="number" inputMode="decimal" step="0.1" placeholder="如 75" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} />
              </div>
              <div className="field">
                <label>目标体重（kg）</label>
                <input type="number" inputMode="decimal" step="0.1" placeholder="如 80" value={form.target_weight_kg} onChange={e => set('target_weight_kg', e.target.value)} />
              </div>
            </div>
            <div className="field-row2">
              <div className="field">
                <label>身高（cm，选填）</label>
                <input type="number" inputMode="decimal" placeholder="如 175" value={form.height_cm} onChange={e => set('height_cm', e.target.value)} />
              </div>
              <div className="field">
                <label>年龄（选填）</label>
                <input type="number" inputMode="numeric" placeholder="如 30" value={form.age} onChange={e => set('age', e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>性别</label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                <button className={'chip' + (form.gender === 'male' ? ' active' : '')} onClick={() => set('gender', 'male')}>男</button>
                <button className={'chip' + (form.gender === 'female' ? ' active' : '')} onClick={() => set('gender', 'female')}>女</button>
              </div>
            </div>

            <div className="field">
              <label>日常活动水平</label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {ACTIVITY_OPTIONS.map(o => (
                  <button key={o.value} className={'chip' + (Number(form.activity) === o.value ? ' active' : '')} onClick={() => set('activity', o.value)}>{o.label}</button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>训练经验</label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {EXPERIENCE_OPTIONS.map(o => (
                  <button key={o.id} className={'chip' + (form.experience === o.id ? ' active' : '')} onClick={() => set('experience', o.id)}>{o.label}</button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>每周计划训练天数</label>
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {[2, 3, 4, 5, 6].map(d => (
                  <button key={d} className={'chip' + (Number(form.weekly_days) === d ? ' active' : '')} onClick={() => set('weekly_days', d)}>{d} 天</button>
                ))}
              </div>
            </div>

            {targets && (
              <div className="hint" style={{ marginBottom: 12 }}>
                按当前体重，每日目标约 <b>{targets.kcal} kcal</b> 热量、<b>{targets.protein} g</b> 蛋白质
              </div>
            )}
            {err && <div className="banner banner-error">{err}</div>}
            {msg && <div className="banner banner-warn" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>{msg}</div>}
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存目标'}</button>
          </>
        )}
      </div>

      <button className="btn btn-ghost" onClick={signOut}>退出登录</button>
    </div>
  )
}
