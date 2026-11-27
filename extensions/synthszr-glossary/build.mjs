import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vite/package.json'))
const esbuild = viteRequire('esbuild')
const sharp = require('sharp')
const JSZip = require('jszip')

const DIST_DIR = path.join(__dirname, 'dist')
const MANIFEST_PATH = path.join(__dirname, 'manifest.json')
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="26" fill="#111114"/>
  <rect x="22" y="96" width="84" height="10" rx="5" fill="#CCFF00"/>
  <text x="64" y="82" text-anchor="middle" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="800" font-size="72" fill="#FFFFFF">S</text>
</svg>`

async function buildExtension() {
  fs.rmSync(DIST_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(DIST_DIR, 'background'), { recursive: true })
  fs.mkdirSync(path.join(DIST_DIR, 'content'), { recursive: true })
  fs.mkdirSync(path.join(DIST_DIR, 'popup'), { recursive: true })
  fs.mkdirSync(path.join(DIST_DIR, 'icons'), { recursive: true })

  // 1. Bundle background service worker, content script, and popup script (IIFE for Chrome + Safari parity)
  await Promise.all([
    esbuild.build({
      entryPoints: [path.join(__dirname, 'src/background/service-worker.ts')],
      bundle: true,
      format: 'iife',
      target: ['chrome120', 'safari17'],
      minify: true,
      outfile: path.join(DIST_DIR, 'background/service-worker.js'),
    }),
    esbuild.build({
      entryPoints: [path.join(__dirname, 'src/content/content.ts')],
      bundle: true,
      format: 'iife',
      target: ['chrome120', 'safari17'],
      minify: true,
      outfile: path.join(DIST_DIR, 'content/content.js'),
    }),
    esbuild.build({
      entryPoints: [path.join(__dirname, 'src/popup/popup.ts')],
      bundle: true,
      format: 'iife',
      target: ['chrome120', 'safari17'],
      minify: true,
      outfile: path.join(DIST_DIR, 'popup/popup.js'),
    }),
  ])

  // 2. Copy static assets
  fs.copyFileSync(MANIFEST_PATH, path.join(DIST_DIR, 'manifest.json'))
  fs.copyFileSync(path.join(__dirname, 'src/content/highlight.css'), path.join(DIST_DIR, 'content/highlight.css'))
  fs.copyFileSync(path.join(__dirname, 'src/popup/popup.html'), path.join(DIST_DIR, 'popup/popup.html'))
  fs.copyFileSync(path.join(__dirname, 'src/popup/popup.css'), path.join(DIST_DIR, 'popup/popup.css'))

  // 3. Render PNG icons from SVG via sharp
  const svgBuffer = Buffer.from(ICON_SVG)
  for (const size of [16, 32, 48, 128]) {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(DIST_DIR, 'icons', `icon-${size}.png`))
  }

  // 4. Package Chrome Web Store / unpacked distribution ZIP
  const zip = new JSZip()
  const addDirToZip = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        addDirToZip(full, rel)
      } else {
        zip.file(rel, fs.readFileSync(full))
      }
    }
  }
  addDirToZip(DIST_DIR)

  const zipName = `synthszr-glossary-v${manifest.version}.zip`
  const zipPath = path.join(__dirname, zipName)
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })
  fs.writeFileSync(zipPath, zipBuffer)

  console.log(`Built Synthszr Lexikon v${manifest.version}:`)
  console.log(`  Unpacked: ${DIST_DIR}`)
  console.log(`  Archive:  ${zipPath} (${(zipBuffer.length / 1024).toFixed(1)} KB)`)
}

buildExtension().catch((err) => {
  console.error('Extension build failed:', err)
  process.exit(1)
})
