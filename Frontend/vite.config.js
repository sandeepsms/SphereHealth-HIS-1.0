import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // R7fs-FIX: `@` → /src alias. R7fq/R7fr migration introduced
  // `@/templates/PrintShell` imports into 9 files (6 printables + 3
  // pages). Without this alias Vite returned 500 on each, which
  // cascaded as "Failed to fetch dynamically imported module" on
  // /print-gallery and any page that lazy-imports them. Convention
  // matches Vite docs, Vue/Nuxt, most React templates.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      // Dev parity with the Docker nginx proxy: stored PHI file URLs are
      // origin-relative (`/uploads/...`), served by the authenticated
      // backend route (Backend/routes/Files/uploadsRoutes.js). Forward
      // them to the backend in dev exactly like nginx does in prod.
      '/uploads': {
        target: 'http://localhost:5050',
        changeOrigin: true,
      },
    },
  },
  build: {
    // R7bf-J/A8-CRIT-5: aggressive vendor splitting. Pre-R7bf the
    // catch-all `vendor-misc` ballooned to 857 KB — bootstrap +
    // react-bootstrap + @emotion + lucide-react + react-icons + yup +
    // html2pdf.js all landed there together. Target: every vendor chunk
    // under 500 KB so first-paint on 3G/4G in tier-3 cities is OK.
    chunkSizeWarningLimit: 600,
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
          if (id.includes('axios') || id.includes('react-query') || id.includes('formik') || id.includes('yup'))
            return 'vendor-data'

          // ── PrimeReact (icons + components) ───────────────
          if (id.includes('primereact') || id.includes('primeicons') || id.includes('primeflex'))
            return 'vendor-prime'

          // ── Charts (recharts/chart.js if used) ────────────
          if (id.includes('recharts') || id.includes('chart.js') || id.includes('d3-'))
            return 'vendor-charts'

          // ── PDF / print ───────────────────────────────────
          // R7bf-J/A8-CRIT-5: html2pdf.js ships its own copy of
          // html2canvas + jspdf and is ~700 KB on its own — isolate it
          // so the rest of the app's print stack stays light. Pages
          // that use it should `import()` lazily; this chunk only ships
          // on routes that touch it.
          if (id.includes('html2pdf'))
            return 'vendor-pdf-html2pdf'
          if (id.includes('jspdf') || id.includes('html2canvas')
              || id.includes('react-to-print'))
            return 'vendor-pdf'

          // ── Toast / notifications ─────────────────────────
          if (id.includes('react-toastify') || id.includes('sweetalert'))
            return 'vendor-ui'

          // ── Date utilities ────────────────────────────────
          if (id.includes('date-fns') || id.includes('dayjs') || id.includes('moment'))
            return 'vendor-date'

          // R7bf-J/A8-CRIT-5: pull the heavy CSS-in-JS runtime out of
          // vendor-misc. @emotion is dragged in by react-bootstrap +
          // MUI-style libs and is ~100 KB on its own.
          if (id.includes('@emotion') || id.includes('@babel/runtime'))
            return 'vendor-emotion'

          // R7bf-J/A8-CRIT-5: bootstrap css/js + react-bootstrap.
          // ~200 KB combined — used by every layout.
          if (id.includes('react-bootstrap') || id.includes('/bootstrap/')
              || id.includes('/@restart/'))
            return 'vendor-bootstrap'

          // R7bf-J/A8-CRIT-5: icon families. lucide-react +
          // react-icons are tree-shakeable but the unused exports still
          // bloat the misc chunk because of barrel-import patterns —
          // isolating them keeps the misc chunk truly miscellaneous.
          if (id.includes('lucide-react') || id.includes('react-icons'))
            return 'vendor-icons'

          // Everything else goes to a generic vendor chunk
          return 'vendor-misc'
        },
      },
    },
  },
})
