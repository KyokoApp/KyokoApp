import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Opsional: source tags plugin jika ada
    (async (): Promise<Plugin | null> => {
      try {
        // @ts-ignore
        const m = await import('./.vite-source-tags.js')
        return m.sourceTags()
      } catch {
        return null
      }
    })() as unknown as Plugin,
  ].filter(Boolean),
  build: {
    // Minifikasi dengan esbuild (lebih cepat dari terser)
    minify: 'esbuild',
    // Target modern browser — output lebih kecil
    target: 'es2020',
    rollupOptions: {
      output: {
        // Manual chunks — pisah vendor besar supaya main bundle ringan
        manualChunks: {
          // Firebase jarang berubah → cache browser lama
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          // React ecosystem
          'vendor-react': ['react', 'react-dom'],
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Warn jika chunk > 600KB
    chunkSizeWarningLimit: 600,
    // Matikan source map di production
    sourcemap: false,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'firebase/app', 'firebase/auth', 'firebase/firestore'],
  },
})
