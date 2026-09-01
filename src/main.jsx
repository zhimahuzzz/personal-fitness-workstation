import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')).render(<App />)

// 生产环境注册 Service Worker（PWA 主屏图标 + 离线访问）
// BASE_URL 在本地开发为 '/'，部署后为 '/personal-fitness-workstation/'，必须跟随，否则注册到错误路径
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(err => console.warn('SW 注册失败：', err))
  })
}
