import React, { useMemo } from 'react'

/**
 * 轻量趋势折线图（SVG 手绘，无依赖）
 * @param {{date:string, value:number}[]} data 按日期升序
 * @param {string} unit 'kg' | '%'
 * @param {number} height 画布高度（像素，默认 140）
 */
export default function TrendChart({ data = [], unit = '', height = 140 }) {
  const W = 360
  const H = height
  const PAD = { t: 18, r: 14, b: 20, l: 34 }

  const chart = useMemo(() => {
    const rows = data.filter(d => d.value != null && !Number.isNaN(Number(d.value)))
    if (!rows.length) return null

    const values = rows.map(r => Number(r.value))
    let min = Math.min(...values)
    let max = Math.max(...values)
    if (min === max) { min -= 1; max += 1 }
    const span = max - min
    min -= span * 0.12
    max += span * 0.12

    const iw = W - PAD.l - PAD.r
    const ih = H - PAD.t - PAD.b
    const x = i => (rows.length === 1 ? PAD.l + iw / 2 : PAD.l + (i / (rows.length - 1)) * iw)
    const y = v => PAD.t + ih - ((v - min) / (max - min)) * ih

    const pts = rows.map((r, i) => ({ x: x(i), y: y(Number(r.value)), ...r }))
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.t + ih).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.t + ih).toFixed(1)} Z`

    // 纵轴：3 条网格线 + 数值
    const gridYs = [0, 0.5, 1].map(t => PAD.t + ih - t * ih)
    const gridVals = [0, 0.5, 1].map(t => min + t * (max - min))

    const fmt = v => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10)
    const firstDate = rows[0].date.slice(5)
    const lastDate = rows[rows.length - 1].date.slice(5)

    return { pts, line, area, gridYs, gridVals, fmt, firstDate, lastDate, bottomY: PAD.t + ih }
  }, [data, H])

  if (!chart) return <div className="empty">暂无数据，记录后这里会出现趋势曲线</div>

  const { pts, line, area, gridYs, gridVals, fmt, firstDate, lastDate, bottomY } = chart
  const last = pts[pts.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {/* 网格线与刻度 */}
      {gridYs.map((gy, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="#E4EAE6" strokeWidth="1" strokeDasharray={i === 2 ? '0' : '3 3'} />
          <text x={PAD.l - 6} y={gy + 3.5} textAnchor="end" fontSize="10" fill="#93A09A">{fmt(gridVals[i])}</text>
        </g>
      ))}

      {/* 面积与折线 */}
      <path d={area} fill="var(--primary-soft)" opacity="0.55" />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

      {/* 数据点（多且密时只画首尾，避免拥挤） */}
      {pts.length <= 20
        ? pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 2.6} fill="var(--primary)" stroke="#fff" strokeWidth={i === pts.length - 1 ? 2 : 0} />)
        : <circle cx={last.x} cy={last.y} r="4" fill="var(--primary)" stroke="#fff" strokeWidth="2" />}

      {/* 最新值标签 */}
      <text x={Math.min(last.x + 8, W - PAD.r - 6)} y={Math.max(last.y - 8, 11)} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--primary)">
        {fmt(last.value)}{unit}
      </text>

      {/* 日期轴 */}
      <text x={PAD.l} y={H - 6} fontSize="10" fill="#93A09A">{firstDate}</text>
      {pts.length > 1 && <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="10" fill="#93A09A">{lastDate}</text>}
      <line x1={PAD.l} x2={W - PAD.r} y1={bottomY} y2={bottomY} stroke="#D8E0DB" strokeWidth="1" />
    </svg>
  )
}
