/**
 * Gemeinsamer Abschluss der drei curation:*-Scripts (Task 14 Fix-Runde 1,
 * Review Important #2): `flushUsageLog()` muss VOR `process.exit` laufen,
 * AUCH wenn `main()` wirft — sonst gehen offene `llm_usage`-Inserts verloren.
 * `after()` wirft ausserhalb eines Request-Scopes synchron und weicht auf das
 * Fallback-Set `pending` aus (lib/ai/usage-log.ts:63-72); `flushUsageLog`
 * wartet genau auf dieses Set (lib/ai/usage-log.ts:138) — ein `process.exit`
 * vor diesem Warten beendet den Node-Prozess, bevor die Inserts fertig sind.
 * Vorher stand das nur im Erfolgspfad jedes Scripts; ein geworfener Fehler
 * (z. B. ein Compose-Call, der nicht abgefangen wurde) sprang direkt in
 * `.catch(...)` und liess `flushUsageLog()` aus.
 *
 * `main()` liefert selbst den Exit-Code (0/1) fuer erwartete Faelle
 * (ungueltige Argumente, Budget ueberschritten, einzelne fehlgeschlagene
 * Tage); ein Wurf aus `main()` ist der Rest-Fall fuer Unerwartetes und
 * fuehrt ebenfalls zu Exit 1, NACH dem Flush.
 */
export async function runScript(main: () => Promise<number>): Promise<never> {
  let code: number
  try {
    code = await main()
  } catch (err) {
    console.error(err)
    code = 1
  } finally {
    const { flushUsageLog } = await import('@/lib/ai/usage-log')
    await flushUsageLog()
  }
  process.exit(code)
}
