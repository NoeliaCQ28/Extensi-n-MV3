import { defineConfig } from 'vite'
import { resolve } from 'path'
import fs from 'fs'

function collectContentEntries() {
  const dir = resolve(__dirname, 'src', 'content')
  if (!fs.existsSync(dir)) return {}
  const files = fs.readdirSync(dir)
  const entries: Record<string, string> = {}
  for (const file of files) {
    const full = resolve(dir, file)
    const stat = fs.statSync(full)
    if (!stat.isFile()) continue
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue
    const base = file.replace(/\.tsx?$|\.jsx?$/,'')
    // prefix to avoid collisions with other entry names
    entries[`content_${base}`] = full
  }
  return entries
}

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: Object.assign(
        {
          popup: resolve(__dirname, 'src/popup/popup.html'),
          background: resolve(__dirname, 'src/background/background.ts')
        },
        collectContentEntries()
      ),
      output: {
        // Emit popup bundle next to its HTML, and place content scripts under dist/content/
        entryFileNames: (chunkInfo) => {
          const name = chunkInfo.name || ''
          if (name === 'popup') return 'src/popup/popup.js'
          if (name.startsWith('content_')) return `content/${name.replace('content_', '')}.js`
          return '[name].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  }
})
