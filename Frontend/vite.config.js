import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split the 4.3 MB single bundle into smaller, browser-cacheable chunks.
    // Browsers can download these in parallel and cache them independently,
    // so a single page change doesn't invalidate the whole vendor cache.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Roadmap E17 — group all clinical tab files under a single
          // browser-cacheable chunk. Tab files placed under
          // src/Components/clinical/tabs/ will get split into this chunk
          // automatically when they're React.lazy()-imported.
          if (id.includes('/Components/clinical/tabs/')) return 'panel-tabs'
          // Safety / safety components — small, infrequent, separate chunk
          if (id.includes('/Components/safety/')) return 'panel-safety'

          if (!id.includes('node_modules')) return undefined

          // ── React core ────────────────────────────────────
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler'))
            return 'vendor-react'

          // ── Routing ───────────────────────────────────────
          if (id.includes('react-router') || id.includes('@remix-run'))
            return 'vendor-router'

          // ── HTTP / data ───────────────────────────────────
          if (id.includes('axios') || id.includes('react-query') || id.includes('formik'))
            return 'vendor-data'

          // ── PrimeReact (icons + components) ───────────────
          if (id.includes('primereact') || id.includes('primeicons'))
            return 'vendor-prime'

          // ── Charts (recharts/chart.js if used) ────────────
          if (id.includes('recharts') || id.includes('chart.js') || id.includes('d3-'))
            return 'vendor-charts'

          // ── PDF / print ───────────────────────────────────
          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('react-to-print'))
            return 'vendor-pdf'

          // ── Toast / notifications ─────────────────────────
          if (id.includes('react-toastify') || id.includes('sweetalert'))
            return 'vendor-ui'

          // ── Date utilities ────────────────────────────────
          if (id.includes('date-fns') || id.includes('dayjs') || id.includes('moment'))
            return 'vendor-date'

          // Everything else goes to a generic vendor chunk
          return 'vendor-misc'
        },
      },
    },
  },
})
