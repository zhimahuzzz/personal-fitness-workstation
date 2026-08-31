import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" /><rect x="3" y="15" width="7" height="6" rx="1.5" />
    </svg>
  ),
  training: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" />
    </svg>
  ),
  diet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11h16a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z" /><path d="M8 21h8M10 8c0-2 1-3 2-4 1 1 2 2 2 4" />
    </svg>
  ),
  body: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2.5" /><path d="M12 8v7M7 24l3-6-1-3M17 24l-3-6 1-3M8 11l-3 2M16 11l3 2" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  )
}

const tabs = [
  { to: '/', label: '仪表盘', icon: icons.dashboard, end: true },
  { to: '/training', label: '训练', icon: icons.training },
  { to: '/diet', label: '饮食', icon: icons.diet },
  { to: '/body', label: '状态', icon: icons.body },
  { to: '/me', label: '我的', icon: icons.me }
]

export default function TabBar() {
  const location = useLocation()
  return (
    <nav className="tab-bar">
      <div className="tab-bar-inner">
        {tabs.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={`tab-item ${location.pathname === t.to ? 'active' : ''}`}
          >
            {t.icon}
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
