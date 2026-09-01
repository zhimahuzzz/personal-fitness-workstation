// 老张健身工作台 Service Worker
// 同源静态资源 cache-first，导航请求网络失败时回退到缓存的 index.html
// 跨域请求（Supabase）不拦截，保证数据实时性
// 注意：所有路径用相对写法（'./xxx'），会基于 sw.js 所在目录解析，
// 这样本地开发（/）和 GitHub Pages（/personal-fitness-workstation/）都能正确工作

const CACHE_NAME = 'fwd-v2'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png']

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html'))
    )
    return
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone()
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone))
        }
        return resp
      }).catch(() => cached)
    })
  )
})
