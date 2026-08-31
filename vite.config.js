import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目页：仓库名 personal-fitness-workstation，部署在用户名.github.io/personal-fitness-workstation/
// base 路径决定打包后静态资源的 URL 前缀，必须与部署路径一致
export default defineConfig({
  base: '/personal-fitness-workstation/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true
  }
})
