/**
 * Monthly A2 Print Poster Generator:
 * Queries live 90-day Synthszr Charts data from Supabase, renders the pure
 * vector SVG poster via ReactDOMServer, and exports:
 *   1. Immutable JSON snapshot (data/posters/issue-XX-YYYY-MM.json)
 *   2. Vector A2 Print PDF (420 × 594 mm, 300 DPI) via Playwright
 *   3. High-res PNG preview for visual QA / sharing
 *
 * Usage: npx tsx scripts/generate-momentum-map.ts
 */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { buildMomentumMapData } from '@/lib/rankings/momentum-map'
import { MomentumMapPoster } from '@/components/rankings/momentum-map-poster'

async function main() {
  const data = await buildMomentumMapData()
  const outDir = join(process.cwd(), 'data', 'posters')
  mkdirSync(outDir, { recursive: true })

  const slug = data.monthLabel.toLowerCase().replace(/\s+/g, '-')
  const baseName = `synthszr-momentum-map-issue-${String(data.issueNumber).padStart(2, '0')}-${slug}`

  writeFileSync(join(outDir, `${baseName}.json`), JSON.stringify(data, null, 2), 'utf8')

  const svgMarkup = renderToStaticMarkup(React.createElement(MomentumMapPoster, { data }))
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SYNTHSZR MOMENTUM MAP · ${data.monthLabel}</title>
  <style>
    @page { size: 420mm 594mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 420mm; height: 594mm; background: #F6F5F0; overflow: hidden; }
    svg { display: block; width: 420mm; height: 594mm; }
  </style>
</head>
<body>${svgMarkup}</body>
</html>`

  writeFileSync(join(outDir, `${baseName}.svg`), `<?xml version="1.0" encoding="UTF-8"?>\n${svgMarkup}`, 'utf8')

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch())
  try {
    const page = await browser.newPage({ viewport: { width: 1260, height: 1782 }, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'networkidle' })
    const pdfPath = join(outDir, `${baseName}.pdf`)
    const pngPath = join(outDir, `${baseName}.png`)
    await page.pdf({
      path: pdfPath,
      width: '420mm',
      height: '594mm',
      printBackground: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    })
    await page.screenshot({ path: pngPath, fullPage: true })
    console.log('Generated:')
    console.log('  JSON:', join(outDir, `${baseName}.json`))
    console.log('  SVG: ', join(outDir, `${baseName}.svg`))
    console.log('  PDF: ', pdfPath)
    console.log('  PNG: ', pngPath)
    console.log(`Stats: ${data.totalMentions90d} mentions (90d), ${data.categories.length} categories, ${data.heroTop12.length} hero products`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
