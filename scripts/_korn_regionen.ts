/** Bestimmt je Bestandsbild die Region, in der das Korn leben soll — per Vision
 *  auf dem FERTIGEN Dither-Bild, ohne es neu zu generieren.
 *  Eine grobe Box genuegt: ausserhalb des Motivs liegt Weissraum, und dort
 *  findet der Halbton-Filter ohnehin nichts zum Bewegen. */
import { config } from 'dotenv'
import os from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
config({ path: os.homedir() + '/.synthszr.env.prod', quiet: true })

const SP = '/private/tmp/claude-501/-Users-mattes-Library-CloudStorage-Dropbox-dev-synthszr/5d78afe8-8009-4059-a6f5-7d1673bdf223/scratchpad/r2'
const KEY = (process.env.GOOGLE_GENERATIVE_AI_API_KEY || '').trim()

async function region(name: string, url: string) {
  const bild = Buffer.from(await (await fetch(url)).arrayBuffer())
  const prompt = `Dieses Bild ist die Illustration zum Lexikonbegriff "${name}".
Es ist eine 1-Bit-Rasterzeichnung (schwarze Punkte auf weiss).

Bestimme den EINEN Bildbereich, der den Kern des dargestellten Objekts traegt —
das Teil, auf das ein Betrachter zuerst schaut und an dem sich der Begriff zeigt.
Nicht der Sockel, nicht der Schatten, nicht der leere Rand.

Antworte NUR mit JSON, ohne Markdown-Zaun, Werte in PROZENT der Bildkante (0-100):
{"was":"was in diesem Bereich zu sehen ist, 3-8 Woerter",
 "x":linke Kante, "y":obere Kante, "w":Breite, "h":Hoehe,
 "anteil":geschaetzter Anteil des Bildes in Prozent}
Die Box soll das Teil knapp umschliessen, nicht das ganze Bild.`

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: bild.toString('base64') } }] }],
    }),
  })
  const j: any = await r.json()
  if (j.error) return { fehler: j.error.message }
  const t = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || ''
  try { return JSON.parse(t.replace(/```json?|```/g, '').trim()) } catch { return { fehler: 'kein JSON: ' + t.slice(0, 120) } }
}

async function main() {
  const kandidaten = JSON.parse(readFileSync(SP + '/echte.json', 'utf8'))
  const out: any[] = []
  for (const k of kandidaten) {
    const rg = await region(k.name, k.url)
    if (rg.fehler) { console.log('FEHLER', k.slug, rg.fehler); continue }
    const box = [Math.max(0, rg.x), Math.max(0, rg.y), Math.min(100, rg.w), Math.min(100, rg.h)].map((v: number) => +Number(v).toFixed(1))
    out.push({ ...k, region: box, was: rg.was })
    console.log(k.slug.padEnd(22), `[${box.join(', ')}]`.padEnd(30), rg.was)
    writeFileSync(SP + '/regionen.json', JSON.stringify(out, null, 1))
  }
}
void main()
