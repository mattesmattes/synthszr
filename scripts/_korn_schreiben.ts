/** Schreibt fuer die zehn Pilotbegriffe das neue Verfahren in animation_params.
 *  Bewusst OHNE Staerke: die normiert der Client selbst an einem Messpass, weil
 *  die Zahl der Spruenge linear von ihr abhaengt. Alle uebrigen Begriffe behalten
 *  ihre alten Werte und werden von der Komponente ab jetzt ignoriert. */
import { config } from 'dotenv'
import os from 'node:os'
import { readFileSync } from 'node:fs'
config({ path: os.homedir() + '/.synthszr.env.prod', quiet: true })

const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SP = '/private/tmp/claude-501/-Users-mattes-Library-CloudStorage-Dropbox-dev-synthszr/5d78afe8-8009-4059-a6f5-7d1673bdf223/scratchpad/r2'

async function main() {
  const trocken = !process.argv.includes('--apply')
  const regionen = JSON.parse(readFileSync(SP + '/regionen.json', 'utf8'))
  for (const r of regionen) {
    const params = { verfahren: 'korn', region: r.region, was: r.was }
    if (trocken) { console.log('[trocken]', r.slug, JSON.stringify(params)); continue }
    const resp = await fetch(`${U}/rest/v1/glossary_terms?slug=eq.${r.slug}`, {
      method: 'PATCH',
      headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ animation_params: params }),
    })
    console.log(resp.ok ? 'OK ' : 'FEHLER ' + resp.status, r.slug, JSON.stringify(params.region))
  }
  if (trocken) console.log('\nTrockenlauf. Mit --apply wirklich schreiben.')
}
void main()
