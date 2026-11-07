/**
 * Torwaechter der Tageskette (Abruf -> Analyse -> Artikel).
 *
 * BEFUND 2026-08-23, der diese Regeln noetig gemacht hat: Der Newsletter-Abruf
 * lief um 03:46 und sammelte NULL Artikel, weil die Newsletter an dem Tag erst
 * gegen 07:00 eintrafen. Der Scheduler markierte den Lauf trotzdem als erledigt
 * — null Artikel sind formal kein Fehler — und `hasRunToday` sperrte danach
 * jeden weiteren Versuch des Tages. Der Cron lief alle 15 Minuten weiter und
 * haette die 07:00-Welle muehelos erwischt; er hielt den Schritt nur faelschlich
 * fuer abgeschlossen. Ohne Quellmaterial fiel die Tagesanalyse aus, und weil die
 * Post-Erzeugung an ihr haengt, entstand kein Artikel.
 */

/**
 * Ein Schritt gilt nur als erledigt, wenn er ETWAS BEWIRKT hat.
 *
 * `produced` ist die Zahl der Dinge, die er hervorgebracht hat (eingesammelte
 * Mails, erzeugte Eintraege). Fehlt sie, zaehlt allein `success` — nicht jeder
 * Schritt produziert Zaehlbares. Ist sie da und null, bleibt der Schritt OFFEN
 * und wird beim naechsten Tick wiederholt, bis Material eintrifft.
 */
export function isStepComplete(result: { success: boolean; produced?: number }): boolean {
  if (!result.success) return false
  if (result.produced === undefined) return true
  return result.produced > 0
}

/**
 * Darf der nachfolgende Schritt loslaufen?
 *
 * `waiting` heisst ausdruecklich NICHT „heute abgehakt": der naechste Tick
 * versucht es erneut. Genau daran hing der 2026-08-23 — die Kette darf sich
 * verspaeten, aber sie darf den Tag nicht aufgeben, nur weil die Vorstufe zur
 * geplanten Uhrzeit noch nicht fertig war.
 */
export function dependencyGate(previousState: string | undefined): 'ready' | 'waiting' {
  return previousState === 'completed' || previousState === 'already_ran' ? 'ready' : 'waiting'
}

/**
 * Darf die Tagesanalyse loslaufen?
 *
 * BEFUND 2026-11-07: Der Abruf hing bis 06:46 (Gmail-Token ungueltig), die
 * Analyse lief trotzdem um 04:16 — das 28h-Fenster enthielt noch Material vom
 * Vortag, also gab es kein „keine Quellen". Damit galt der Tag als analysiert,
 * und alles, was danach eintraf, erreichte die Queue nie. Die Analyse wartet
 * deshalb, bis der Abruf HEUTE erledigt ist.
 */
export function analysisGate(opts: { fetchEnabled: boolean; fetchState: string | undefined }): 'ready' | 'waiting' {
  return opts.fetchEnabled ? dependencyGate(opts.fetchState) : 'ready'
}

/**
 * Was bedeutet das Ergebnis des Digest-Inserts fuer die Tageskette?
 *
 * Seit 2026-11-07 gilt ein Unique-Index auf daily_digests.digest_date
 * (Migration 20261107090000). Scheitert der Insert mit 23505, hat ein
 * paralleler Lauf den Digest schon gespeichert und fuehrt die Synthese aus —
 * dieser Lauf ist dann erledigt, nicht gestoert.
 */
export function digestInsertOutcome(error: { code?: string; message?: string } | null): 'saved' | 'parallel_run' | 'error' {
  if (!error) return 'saved'
  return error.code === '23505' ? 'parallel_run' : 'error'
}
