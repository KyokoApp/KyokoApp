import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(async () => {
  const plugins = [react(), tailwindcss()]
  try {
    // @ts-ignore
    const m = await import('./.vite-source-tags.js')
    plugins.push(m.sourceTags())
  } catch {}

  return {
    plugins,
    build: {
      // Gunakan terser untuk minifikasi lebih agresif
      minify: 'esbuild',
      // Target modern browser - lebih kecil output
      target: 'es2020',
      // Pisahkan chunk lebih kecil agar browser bisa cache lebih efisien
      rollupOptions: {
        output: {
          // Manual chunks — pisahkan vendor besar supaya main bundle ringan
          manualChunks: {
            // Firebase — library besar, jarang berubah → cache browser lama
            'vendor-firebase': [
              'firebase/app',
              'firebase/auth',
              'firebase/firestore',
            ],
            // React ecosystem
            'vendor-react': ['react', 'react-dom'],
          },
          // Nama chunk yang jelas & mudah di-cache
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      // Warn jika chunk > 600KB (default 500KB terlalu ketat)
      chunkSizeWarningLimit: 600,
      // Kurangi overhead dengan menonaktifkan source map di production
      sourcemap: false,
    },
    // Optimalkan dependency pre-bundling
    optimizeDeps: {
      include: ['react', 'react-dom', 'firebase/app', 'firebase/auth', 'firebase/firestore'],
    },
  }
})
