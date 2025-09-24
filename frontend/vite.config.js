import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: {
    host: true,
    // Allow external hosts like Cloudflare Tunnel URLs
    allowedHosts: true,
  },
})
