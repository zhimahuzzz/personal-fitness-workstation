import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import TrendChart from '../components/TrendChart'
import { aiEstimateBodyFat } from '../lib/ai'

const pad = n => String(n).padStart(2, '0')
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const BUCKET = 'progress-photos'

// 压缩为最大 1080px 的 JPEG Blob（进度照片要长期保存，兼顾清晰度与体积）
function compressToBlob(file, cb) {
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const max = 1080
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(b => cb(b), 'image/jpeg', 0.8)
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

// Blob 转 dataURL（发给 AI 识别用）
const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result)
  r.onerror = reject
  r.readAsDataURL(blob)
})

export default function BodyStatus() {
  const { user } = useAuth()
  const [metrics, setMetrics] = useState([])
  const [photos, setPhotos] = useState([]) // [{id, taken_date, storage_path, note, url}]
  const [range, setRange] = useState(90) // 30 | 90 | 0(全部)
  const [chartTab, setChartTab] = useState('weight') // weight | fat
  const [recordOpen, setRecordOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pageErr, setPageErr] = useState('')
  const [aiFatMsg, setAiFatMsg] = useState('') // AI 估体脂的结果提示
  const fileRef = useRef(null)

  const loadAll = useCallback(async () => {
    if (!supabase || !user) return
    const [{ data: bm }, { data: pp }] = await Promise.all([
      supabase.from('body_metrics').select('*').order('measured_date'),
      supabase.from('progress_photos').select('*').order('taken_date', { ascending: false }),
    ])
    setMetrics(bm || [])
    const rows = pp || []
    if (rows.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(rows.map(r => r.storage_path), 3600)
      const urlMap = {}
      for (const s of signed || []) if (s.signedUrl) urlMap[s.path] = s.signedUrl
      setPhotos(rows.map(r => ({ ...r, url: urlMap[r.storage_path] || '' })))
    } else {
      setPhotos([])
    }
  }, [user])

  useEffect(() => { loadAll() }, [loadAll])

  // ---- 趋势图数据 ----
  const chartData = useMemo(() => {
    const key = chartTab === 'weight' ? 'weight_kg' : 'body_fat_pct'
    let rows = metrics.filter(m => m[key] != null).map(m => ({ date: m.measured_date, value: Number(m[key]) }))
    if (range > 0) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - range)
      const cs = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`
      rows = rows.filter(r => r.date >= cs)
    }
    return rows
  }, [metrics, chartTab, range])

  const weightStats = useMemo(() => {
    const rows = metrics.filter(m => m.weight_kg != null)
    if (!rows.length) return null
    const latest = rows[rows.length - 1]
    const delta = days => {
      const cutoff = new Date(latest.measured_date + 'T00:00:00')
      cutoff.setDate(cutoff.getDate() - days)
      const cs = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`
      const past = [...rows].reverse().find(r => r.measured_date <= cs)
      return past ? (Number(latest.weight_kg) - Number(past.weight_kg)) : null
    }
    return { latest: Number(latest.weight_kg), date: latest.measured_date, d7: delta(7), d30: delta(30) }
  }, [metrics])

  // ---- 进度照片提醒：距上次超过 10 天 ----
  const daysSincePhoto = useMemo(() => {
    if (!photos.length) return null
    const last = new Date(photos[0].taken_date + 'T00:00:00')
    return Math.floor((Date.now() - last.getTime()) / 864e5)
  }, [photos])

  const onPickPhoto = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setPageErr('')
    setAiFatMsg('')
    compressToBlob(file, async blob => {
      try {
        if (!blob) throw new Error('图片处理失败，请换一张试试')
        const path = `${user.id}/${Date.now()}.jpg`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
        const { error: insErr } = await supabase.from('progress_photos').insert({ user_id: user.id, taken_date: todayStr(), storage_path: path })
        if (insErr) throw insErr
        await loadAll()
        // 照片保存成功后，AI 估算体脂（失败不影响照片，只是不填数）
        setUploading(false)
        setAiFatMsg('🤖 AI 正在估算体脂率…')
        try {
          const dataUrl = await blobToDataUrl(blob)
          const { body_fat_pct, confidence } = await aiEstimateBodyFat(dataUrl)
          if (body_fat_pct) {
            // 只更新当天的体脂率，不动体重等已有数据
            const { error: fatErr } = await supabase
              .from('body_metrics')
              .upsert({ user_id: user.id, measured_date: todayStr(), body_fat_pct }, { onConflict: 'user_id,measured_date' })
            if (fatErr) throw fatErr
            setAiFatMsg(`🤖 AI 估算体脂率约 ${body_fat_pct}%${confidence ? `（可信度：${confidence}）` : ''}，已填入今天记录，可点「记录今天」调整`)
            await loadAll()
          } else {
            setAiFatMsg('🤖 这张照片不太适合估体脂（需要全身或大半身照），可重拍一张或手动填写')
          }
        } catch (e) {
          setAiFatMsg('🤖 体脂估算失败：' + (e.message || '请稍后再试') + '。照片已保存，可手动填写体脂')
        }
      } catch (err) {
        setPageErr('照片上传失败：' + (err.message || '未知错误'))
        setAiFatMsg('')
      } finally {
        setUploading(false)
      }
    })
  }

  const deletePhoto = async p => {
    if (!window.confirm('删除这张进度照片？（云端同步删除，不可恢复）')) return
    await supabase.from('progress_photos').delete().eq('id', p.id)
    await supabase.storage.from(BUCKET).remove([p.storage_path])
    loadAll()
  }

  const today = todayStr()
  const todayMetric = metrics.find(m => m.measured_date === today)

  return (
      <div className="app-shell">
      <div className="page-title">状态</div>
      {pageErr && <div className="banner banner-error">{pageErr}</div>}
      {aiFatMsg && <div className="banner banner-ai">{aiFatMsg}</div>}

      <div className="card">
        <div className="card-title">
          <span>体重 / 体脂</span>
          <button className="btn btn-primary btn-sm" onClick={() => setRecordOpen(true)}>
            {todayMetric ? '修改今天' : '记录今天'}
          </button>
        </div>
        {weightStats ? (
          <div className="stat-grid">
            <div className="stat-cell"><div className="num">{weightStats.latest}</div><div className="lbl">最新体重 kg</div></div>
            <div className="stat-cell">
              <div className={'num' + (weightStats.d7 > 0 ? ' up' : weightStats.d7 < 0 ? ' down' : '')}>{weightStats.d7 == null ? '--' : (weightStats.d7 > 0 ? '+' : '') + weightStats.d7.toFixed(1)}</div>
              <div className="lbl">近 7 天 kg</div>
            </div>
            <div className="stat-cell">
              <div className={'num' + (weightStats.d30 > 0 ? ' up' : weightStats.d30 < 0 ? ' down' : '')}>{weightStats.d30 == null ? '--' : (weightStats.d30 > 0 ? '+' : '') + weightStats.d30.toFixed(1)}</div>
              <div className="lbl">近 30 天 kg</div>
            </div>
          </div>
        ) : (
          <div className="empty">还没有记录，点右上角「记录今天」开始</div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>{chartTab === 'weight' ? '体重趋势' : '体脂趋势'}</span>
          <div className="chip-row" style={{ margin: 0 }}>
            <button className={'chip' + (chartTab === 'weight' ? ' active' : '')} onClick={() => setChartTab('weight')}>体重</button>
            <button className={'chip' + (chartTab === 'fat' ? ' active' : '')} onClick={() => setChartTab('fat')}>体脂</button>
          </div>
        </div>
        <TrendChart data={chartData} unit={chartTab === 'weight' ? 'kg' : '%'} />
        <div className="chip-row" style={{ justifyContent: 'center', marginTop: 8 }}>
          <button className={'chip' + (range === 30 ? ' active' : '')} onClick={() => setRange(30)}>30 天</button>
          <button className={'chip' + (range === 90 ? ' active' : '')} onClick={() => setRange(90)}>90 天</button>
          <button className={'chip' + (range === 0 ? ' active' : '')} onClick={() => setRange(0)}>全部</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>进度照片</span>
          <button className="btn btn-primary btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? '上传中…' : '📷 拍一张'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPickPhoto} />
        {daysSincePhoto != null && daysSincePhoto >= 10 && (
          <div className="banner banner-warn">距上次拍照已 {daysSincePhoto} 天，该拍一张新的对比了</div>
        )}
        {photos.length === 0 ? (
          <div className="empty">每 10 天左右拍一张全身照，长期对比体型变化（照片存云端，仅自己可见）</div>
        ) : (
          <div className="photo-grid">
            {photos.map(p => (
              <div key={p.id} className="photo-cell">
                {p.url ? <img src={p.url} alt={`进度照片 ${p.taken_date}`} /> : <div className="photo-loading">加载中…</div>}
                <div className="photo-date">{p.taken_date.slice(5)}</div>
                <button className="photo-del" onClick={() => deletePhoto(p)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {recordOpen && (
        <RecordSheet
          initial={todayMetric}
          onClose={() => setRecordOpen(false)}
          onSave={async ({ weight, fat, note }) => {
            const payload = { user_id: user.id, measured_date: today, weight_kg: weight || null, body_fat_pct: fat || null, note: note || null }
            const { error } = await supabase.from('body_metrics').upsert(payload, { onConflict: 'user_id,measured_date' })
            if (error) throw error
            await loadAll()
          }}
        />
      )}
    </div>
  )
}

function RecordSheet({ initial, onClose, onSave }) {
  const [weight, setWeight] = useState(initial?.weight_kg ?? '')
  const [fat, setFat] = useState(initial?.body_fat_pct ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    if (!weight && !fat) { setErr('至少填写体重或体脂其中一项'); return }
    setBusy(true)
    try {
      await onSave({
        weight: weight ? Number(weight) : null,
        fat: fat ? Number(fat) : null,
        note: note.trim(),
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
        <div className="card-title"><span>今天的身体数据</span><button className="icon-btn" onClick={onClose}>✕</button></div>
        <div className="field-row2">
          <div className="field">
            <label>体重（kg）</label>
            <input type="number" inputMode="decimal" step="0.1" placeholder="如 75.5" value={weight} onChange={e => setWeight(e.target.value)} />
          </div>
          <div className="field">
            <label>体脂率（%，选填）</label>
            <input type="number" inputMode="decimal" step="0.1" placeholder="如 18.5" value={fat} onChange={e => setFat(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>备注（选填）</label>
          <input type="text" placeholder="如：早起空腹" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        {err && <div className="banner banner-error">{err}</div>}
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </div>
  )
}
