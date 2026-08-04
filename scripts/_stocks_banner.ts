/**
 * Erzeugt das Hero-Banner für die Stocks-Seiten und legt es in den Blob-Store.
 *
 * Aufruf (Prod-Credentials, bereinigte env):
 *   node --env-file=<clean .env> --import tsx scripts/_stocks_banner.ts
 *
 * Baugleich zum Charts-Banner (components/rankings/rankings-banner.tsx): das
 * Motiv wird gedithert und Weiß transparent gemacht, sodass die Flächenfarbe des
 * Containers durchscheint. Beim Charts-Banner ist das Neon-Grün (#00ffb8), hier
 * Neon-Cyan (#00FFFF, --neon-cyan im Design-System).
 *
 * Der Bild-Prompt folgt derselben Ästhetik wie Charts- und Post-Cover
 * (Marmorstatuen), damit die Seite als Teil derselben Familie lesbar bleibt —
 * und er fordert TONWERTE an, weil Floyd-Steinberg Graustufen rastert und eine
 * reine Linienzeichnung nichts zu rastern hätte (Befund D, 2026-08-04).
 *
 * KEIN Wortmark-PNG: der Charts-Banner legt eines auf, für „stocks" gäbe es
 * keines. Die Seite rendert die Wortmarke stattdessen als Text mit der
 * Projekt-Schrift — skaliert schärfer und ist ohne Bildbearbeitung änderbar.
 */
import { writeFileSync } from 'fs'
import { generateRawImage, generateAndProcessImage } from '@/lib/gemini/image-generator'
import { put } from '@vercel/blob'

const PROMPT = [
  'A hyper-realistic classical marble sculpture scene about the stock market:',
  'a monumental marble bull and bear locked together on a plinth, flanked by',
  'fluted columns of an exchange building, carved ticker tape spilling like a',
  'ribbon across the stone.',
  'Style: monochrome marble with rich continuous GRAYSCALE shading — deep',
  'chiaroscuro, polished surfaces, visible chisel texture. Bright overall, lit',
  'from the front, on a PLAIN WHITE background with no dark backdrop.',
  'Wide cinematic composition, subject centred, generous headroom.',
  'No text, no letters, no numbers, no logos anywhere in the image.',
].join('\n')

/**
 * Rohbild direkt über Gemini — Fallback, wenn der konfigurierte Weg scheitert.
 *
 * `vercel env pull` liefert OPENAI_API_KEY als Vercel-seitig redigiertes
 * "[SENSITIVE]", und die DB-Konfiguration für image_generation zeigt auf
 * openai/gpt-image-2 → lokal gibt es dort einen 401. GOOGLE_GENERATIVE_AI_API_KEY
 * ist unredigiert. Dieselbe Konstruktion wie in scripts/_glossary_image_test.ts;
 * die Dither-Pipeline dahinter bleibt die echte.
 */
async function generateRawViaGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY fehlt')
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-image',
    generationConfig: {
      // @ts-expect-error - responseModalities ist bei Bildgenerierung gültig
      responseModalities: ['TEXT', 'IMAGE'],
    },
  })
  const result = await model.generateContent(prompt)
  for (const candidate of result.response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.inlineData) return part.inlineData.data
    }
  }
  throw new Error('Gemini hat kein Bild geliefert')
}

async function main() {
  console.log('[StocksBanner] Rohbild generieren …')
  let rawBase64: string
  const raw = await generateRawImage(PROMPT)
  if (raw.success && raw.imageBase64) {
    rawBase64 = raw.imageBase64
  } else {
    console.log(`[StocksBanner] konfigurierter Weg fehlgeschlagen (${raw.error}) — Gemini-Fallback`)
    rawBase64 = await generateRawViaGemini(PROMPT)
  }
  writeFileSync('/tmp/stocks-banner-raw.png', Buffer.from(rawBase64, 'base64'))
  console.log('[StocksBanner] Rohbild: /tmp/stocks-banner-raw.png')

  // 880x400 wie das Charts-Banner (dort nativ 880x400, 2x als -2x.png).
  const processed = await generateAndProcessImage('stocks-banner', {
    enableDithering: true,
    ditheringGain: 1.0,
    ditheringCoarseness: 1,
    targetWidth: 1760,
    targetHeight: 800,
  }, raw.imageBase64)
  if (!processed.success || !processed.imageBase64) {
    console.error('[StocksBanner] Dithering fehlgeschlagen:', processed.error)
    process.exit(1)
  }
  const local = '/tmp/stocks-banner-2x.png'
  const buf = Buffer.from(processed.imageBase64, 'base64')
  writeFileSync(local, buf)
  console.log(`[StocksBanner] gedithert: ${local} (${Math.round(buf.length / 1024)} KB)`)

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.log('[StocksBanner] KEIN BLOB_READ_WRITE_TOKEN — Upload übersprungen.')
    return
  }
  // Derselbe Store wie die Cover: next.config.mjs whitelistet genau einen
  // remotePatterns-Host, ein anderer ließe next/image zur Laufzeit werfen.
  const blob = await put('stocks/synthszr-stocks-banner-2x.png', buf, {
    access: 'public',
    contentType: 'image/png',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    allowOverwrite: true,
  })
  console.log(`[StocksBanner] hochgeladen: ${blob.url}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
