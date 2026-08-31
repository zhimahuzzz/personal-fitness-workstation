import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TrendChart from '../components/TrendChart'
import { computeTargets, goalProgress } from '../lib/goals'
import { buildWeeklyReport } from '../lib/weeklyReport'

const pad = n => String(n).padStart(2, '0')
const fmtDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayStr = () => fmtDateStr(new Date())
const weekStartStr = () => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return fmtDateStr(d)
}

function PBar({ value, target, color }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  const over = target > 0 && value > target
  return (
    <div className="pbar">
      <i style={{ width: `${pct}%`, background: over ? 'var(--accent)' : color }} />
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [todayMeals, setTodayMeals] = useState([])
  const [weekWorkouts, setWeekWorkouts] = useState([])
  const [weekVolume, setWeekVolume] = useState(0)
  const [metrics, setMetrics] = useState([])
  const [reportOpen, setReportOpen] = useState(false)
  const [reportText, setReportText] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportCopied, setReportCopied] = useState(false)

  const loadAll = useCallback(async () => {
    if (!supabase || !user) return
    const today = todayStr(), ws = weekStartStr()
    const [{ data: p }, { data: meals }, { data: wo }, { data: bm }] = await Promise.all([
      supabase.from('user_profiles').select('*').maybeSingle(),
      supabase.from('meals').select('kcal, protein, carbs, fat').eq('meal_date', today),
      supabase.from('workouts').select('id, title, workout_date').gte('workout_date', ws).order('workout_date'),
      supabase.from('body_metrics').select('measured_date, weight_kg').not('weight_kg', 'is', null).order('measured_date'),
    ])
    setProfile(p)
    setTodayMeals(meals || [])
    setWeekWorkouts(wo || [])
    setMetrics(bm || [])
    const ids = (wo || []).map(w => w.id)
    if (ids.length) {
      const { data: sets } = await supabase.from('workout_sets').select('reps, weight').in('workout_id', ids)
      setWeekVolume((sets || []).reduce((s, r) => s + Number(r.reps) * Number(r.weight), 0))
    } else {
      setWeekVolume(0)
    }
  }, [user])

  useEffect(() => { loadAll() }, [loadAll])

  const targets = useMemo(() => computeTargets(profile), [profile])
  const intake = useMemo(() => ({
    kcal: todayMeals.reduce((s, m) => s + Number(m.kcal || 0), 0),
    protein: todayMeals.reduce((s, m) => s + Number(m.protein || 0), 0),
  }), [todayMeals])

  const weightChart = useMemo(() => metrics.slice(-30).map(m => ({ date: m.measured_date, value: Number(m.weight_kg) })), [metrics])
  const goal = useMemo(() => {
    if (!metrics.length || !profile?.target_weight_kg) return null
    return goalProgress({
      start: Number(metrics[0].weight_kg),
      current: Number(metrics[metrics.length - 1].weight_kg),
      target: Number(profile.target_weight_kg),
    })
  }, [metrics, profile])

  const trainedDays = new Set(weekWorkouts.map(w => w.workout_date)).size

  const openReport = async () => {
    if (!supabase || !user) return
    setReportOpen(true)
    setReportBusy(true)
    setReportText('')
    setReportCopied(false)
    try {
      const ws = weekStartStr()
      const we = todayStr()
      const [{ data: meals }, { data: allSets }, { data: metricsAll }] = await Promise.all([
        supabase.from('meals').select('meal_date, kcal, protein, carbs, fat').gte('meal_date', ws).lte('meal_date', we),
        supabase.from('workout_sets').select('workout_id, exercise_id, set_index, reps, weight').in('workout_id', weekWorkouts.length ? weekWorkouts.map(w => w.id) : ['00000000-0000-0000-0000-000000000000']),
        supabase.from('body_metrics').select('measured_date, weight_kg, body_fat_pct').order('measured_date'),
      ])
      setReportText(buildWeeklyReport({
        profile: profile || {},
        workouts: weekWorkouts,
        sets: allSets || [],
        meals: meals || [],
        metrics: metricsAll || [],
      }))
    } catch (e) {
      setReportText(`生成失败：${e.message || '未知错误'}`)
    } finally {
      setReportBusy(false)
    }
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText)
      setReportCopied(true)
      setTimeout(() => setReportCopied(false), 2000)
    } catch (e) {
      // 降级：选中文本
      const ta = document.getElementById('report-textarea')
      if (ta) { ta.select(); document.execCommand('copy') }
      setReportCopied(true)
      setTimeout(() => setReportCopied(false), 2000)
    }
  }

  return (
    <div className="app-shell">
      <div className="page-title">仪表盘</div>

      <div className="card">
        <div className="card-title"><span>今日摄入</span></div>
        {targets ? (
          <>
            <div className="macro-row">
              <span className="macro">热量 <b>{Math.round(intake.kcal)}</b> / {targets.kcal} kcal</span>
            </div>
            <PBar value={intake.kcal} target={targets.kcal} color="var(--primary)" />
            <div className="macro-row" style={{ marginTop: 10 }}>
              <span className="macro">蛋白质 <b>{Math.round(intake.protein)}</b> / {targets.protein} g</span>
            </div>
            <PBar value={intake.protein} target={targets.protein} color="#3B82C4" />
          </>
        ) : (
          <div className="empty">先在「我的 → 目标设定」里填体重，才能计算每日目标</div>
        )}
      </div>

      <div className="card">
        <div className="card-title"><span>本周训练</span></div>
        <div className="stat-grid">
          <div className="stat-cell"><div className="num">{trainedDays}</div><div className="lbl">训练天数{profile?.weekly_days ? ` / ${profile.weekly_days}` : ''}</div></div>
          <div className="stat-cell"><div className="num">{weekWorkouts.length}</div><div className="lbl">训练场次</div></div>
          <div className="stat-cell"><div className="num">{weekVolume >= 10000 ? (weekVolume / 1000).toFixed(1) + 't' : Math.round(weekVolume)}</div><div className="lbl">总容量 kg</div></div>
        </div>
        {profile?.weekly_days > 0 && trainedDays >= profile.weekly_days && (
          <div className="hint" style={{ marginTop: 8 }}>🎉 本周训练目标已达成</div>
        )}
      </div>

      <div className="card">
        <div className="card-title"><span>体重趋势</span></div>
        <TrendChart data={weightChart} unit="kg" height={110} />
        {goal ? (
          <>
            <div className="macro-row" style={{ marginTop: 10 }}>
              <span className="macro">目标进度 <b>{Math.round(goal.pct * 100)}%</b></span>
              <span className="muted">{goal.text}</span>
            </div>
            <div className="pbar"><div className="pbar-fill" style={{ width: `${goal.pct * 100}%`, background: 'var(--accent, #2F9E6E)' }} /></div>
          </>
        ) : (
          profile?.target_weight_kg == null && <div className="hint" style={{ marginTop: 8 }}>在「我的 → 目标设定」里填目标体重后，这里会显示达成进度</div>
        )}
      </div>

      <button className="btn btn-ghost" onClick={openReport}>📋 导出本周周报（可丢给 AI 分析）</button>

      {reportOpen && (
        <div className="modal-mask" onClick={() => setReportOpen(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="card-title">
              <span>本周周报</span>
              <button className="icon-btn" onClick={() => setReportOpen(false)}>✕</button>
            </div>
            {reportBusy ? (
              <div className="empty">正在汇总数据…</div>
            ) : (
              <>
                <div className="hint" style={{ marginBottom: 8 }}>复制后发给 WorkBuddy（或其他 AI），它会基于你的数据给个性化建议</div>
                <textarea id="report-textarea" className="report-text" readOnly value={reportText} />
                <div className="macro-row" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" onClick={copyReport}>{reportCopied ? '✓ 已复制' : '复制全文'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
