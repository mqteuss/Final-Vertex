import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Em desenvolvimento local, redireciona /api para a função serverless via Vercel CLI
      // ou usa o proxy direto abaixo como fallback
    }
  }
})
