import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn, signUp, isSupabaseConfigured } = useAuth()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'login') {
        await signIn(email.trim(), password)
      } else {
        await signUp(email.trim(), password)
        setInfo('注册成功！如果已开启邮箱验证，请先到邮箱点击确认链接后再登录。')
        setMode('login')
      }
    } catch (err) {
      setError(err.message || '操作失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-logo">
        <div className="auth-logo-mark">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9v6M20 9v6M7 7v10M17 7v10M7 12h10" />
          </svg>
        </div>
        <div>
          <h1>老张健身工作台</h1>
          <div className="muted">记录 · 分析 · 进步</div>
        </div>
      </div>

      {!isSupabaseConfigured && (
        <div className="banner banner-warn">
          云端尚未配置：请先按项目根目录下 <b>SETUP-SUPABASE.md</b> 的指引注册 Supabase 并填写 .env.local，之后刷新本页即可登录使用。
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}
      {info && <div className="banner banner-warn">{info}</div>}

      <form onSubmit={submit}>
        <div className="field">
          <label>邮箱</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="至少 6 位"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={6}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !isSupabaseConfigured}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
        </button>
      </form>

      <div className="auth-switch">
        {mode === 'login' ? (
          <>还没有账号？<a href="#" onClick={e => { e.preventDefault(); setMode('register') }}>注册一个</a></>
        ) : (
          <>已有账号？<a href="#" onClick={e => { e.preventDefault(); setMode('login') }}>直接登录</a></>
        )}
      </div>
    </div>
  )
}
