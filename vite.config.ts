import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      // mirror the Vercel rewrite so local dev also avoids Mappls' missing CORS headers
      '/mappls': {
        target: 'https://search.mappls.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mappls/, ''),
      },
    },
  },
})
