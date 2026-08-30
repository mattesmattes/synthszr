import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { runGlossaryDedupe } from '@/lib/glossary/dedupe-run'

/**
 * Woechentliches Sicherheitsnetz gegen Begriffs-Dubletten im Fachbegriff-Lexikon.
 *
 * Warum das ueberhaupt noetig bleibt (User-Frage 2026-08-30, nach dem
 * manuellen Aufraeumen von 24 Clustern/129 Artikel-Korrekturen): der
 * Kandidaten-Abgleich beim Erzeugen (findTermSlugByName in candidates.ts)
 * prueft neue Kandidaten bereits gegen canonical_name UND aliases aller
 * bekannten Begriffe — aber nur, wenn die exakte Formulierung SCHON als Name
 * oder Alias registriert ist. Zwei bislang unbekannte Schreibvarianten
 * desselben Begriffs (z.B. "MCP" und "Model Context Protocol", beide zum
 * ersten Mal erwaehnt) ergeben weiterhin zwei getrennte Kandidaten — das
 * System hat keine Weltkenntnis, dass beides dasselbe meint, ohne einen
 * teuren semantischen Vergleich pro Kandidat. Dokumentierte, bewusste Grenze
 * seit der Entkopplung 2026-08-04 (s. Kommentar bei addPendingCandidate in
 * candidates.ts) - der Operator sollte den Doppelgaenger beim Freigeben
 * abwaehlen, tut das aber nicht zuverlaessig genug, um eine Ansammlung wie die
 * gefundenen 24 Cluster zu verhindern.
 *
 * Dieser Cron holt das regelmaessig nach, statt es wochenlang anwachsen zu
 * lassen: dieselbe Logik wie scripts/dedupe-glossary-terms.ts --apply
 * (lib/glossary/dedupe-run.ts), nur automatisch statt manuell ausgeloest.
 * Kein Kostenrisiko: reine DB-Reads/-Writes, keine Modell-Aufrufe.
 *
 * ZEITPUNKT Montag 04:00, VOR dem taeglichen glossary-relink (06:00) und den
 * uebrigen 05:00-09:00-Uhr-Glossar-Crons — frisch zusammengefuehrte Aliasse
 * sollen noch am selben Lauf verlinkt werden koennen, nicht erst eine Woche
 * spaeter.
 */
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  try {
    const r = await runGlossaryDedupe(supabase, { apply: true })
    if (r.errors.length) console.error('[GlossaryDedupeCron] Fehler:', r.errors)
    console.log(
      `[GlossaryDedupeCron] ${r.clusterCount} Cluster, ${r.hiddenSlugs.length} versteckt, ` +
      `${r.articlesRelinked}/${r.articlesAffected} Artikel neu verlinkt, ${r.errors.length} Fehler`,
    )
    return NextResponse.json({
      ok: true,
      clusterCount: r.clusterCount,
      hiddenSlugs: r.hiddenSlugs,
      articlesRelinked: r.articlesRelinked,
      articlesAffected: r.articlesAffected,
      errorCount: r.errors.length,
    })
  } catch (err) {
    // Immer 200, wie die uebrigen Cron-Routen dieses Projekts — Vercel
    // fuehrt den Cron sonst als fehlgeschlagen; der naechste Wochenlauf holt
    // liegen gebliebene Dubletten von selbst nach.
    const message = err instanceof Error ? err.message : 'unbekannt'
    console.error('[GlossaryDedupeCron] Lauf fehlgeschlagen:', err)
    return NextResponse.json({ ok: false, error: message })
  }
}
