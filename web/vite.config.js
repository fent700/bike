import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.BIKE_BUILD ? `${version} (${process.env.BIKE_BUILD})` : version),
  },
  // Relative asset URLs. The iOS shell serves the bundle from bike://app/, and
  // the same build also has to work from a sub-path on any static host.
  base: './',
  build: {
    target: 'es2022',
    // mapbox-gl alone is ~1.7 MB minified and cannot be split further.
    chunkSizeWarningLimit: 2600,
  },
})
