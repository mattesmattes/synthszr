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
