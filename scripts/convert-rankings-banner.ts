// Einmal-Script: PNG-Banner/Wordmark aus Vercel Blob laden, als WebP
// (lossless — Dithering-Art verliert bei lossy sichtbar) wieder hochladen.
// Benötigt BLOB_READ_WRITE_TOKEN (vercel env pull --environment=production).
import sharp from 'sharp'
import { put } from '@vercel/blob'

const ASSETS = [
  {
    src: 'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-banner-2x.png',
    dest: 'rankings/synthszr-charts-banner-2x.webp',
  },
  {
    src: 'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/rankings/synthszr-charts-wordmark-white.png',
    dest: 'rankings/synthszr-charts-wordmark-white.webp',
  },
]

// IIFE statt Top-Level-Await: dieses Repo ist CommonJS (kein "type": "module"
// in package.json), tsx transpiliert dann nach cjs, das kein Top-Level-Await kennt.
;(async () => {
  for (const a of ASSETS) {
    const res = await fetch(a.src)
    if (!res.ok) throw new Error(`fetch ${a.src}: ${res.status}`)
    const png = Buffer.from(await res.arrayBuffer())
    const webp = await sharp(png).webp({ lossless: true }).toBuffer()
    const { url } = await put(a.dest, webp, { access: 'public', addRandomSuffix: false, contentType: 'image/webp' })
    console.log(`${a.dest}: ${png.length} B PNG → ${webp.length} B WebP → ${url}`)
  }
})()
