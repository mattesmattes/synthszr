/**
 * Zeitplan-Zeitzone (2026-10-18). Der Scheduler (app/api/cron/scheduled-tasks)
 * vergleicht die Uhrzeiten aus settings.schedule_config mit der Uhr in der
 * konfigurierten IANA-Zone — bis dahin fest Europe/Berlin. WARUM eine Zone
 * statt eines UTC-Offsets: Sommerzeit (EU-Ende 25.10.2026, US-Ende 01.11.2026).
 *
 * WARUM dayKeys ZWEI Daten liefert: Das Digest-Datum ist der lokale Tag der
 * Zone — mit dem UTC-Tag kollidierte der erste Lauf nach einem Zonenwechsel
 * (Shanghai 20:15 UTC) mit dem Berliner Digest desselben UTC-Tages und die
 * Analyse fiele aus. Das Analyse-Fenster bleibt dagegen bei UTC-Tagen, weil
 * daily_repo.newsletter_date UTC-Daten trägt und prepareAnalysisInput genau
 * zwei davon lädt (Zieltag und Vortag): Mit dem lokalen Datum einer Zone weit
 * östlich von UTC fielen die Mails der letzten Stunden vor UTC-Mitternacht
 * aus beiden benachbarten Fenstern heraus.
 */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Berlin'

/** Gültiger IANA-Name? Intl wirft RangeError für alles andere. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Stunde (0–23), Minute und Datum (YYYY-MM-DD) von `now` in der Zone `tz`. */
export function localClock(now: Date, tz: string): { hour: number; minute: number; day: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00'
  return { hour: Number(get('hour')), minute: Number(get('minute')), day: `${get('year')}-${get('month')}-${get('day')}` }
}

/** Lokales Datum (YYYY-MM-DD) von `now` in der Zone `tz` — Tagesmarke des Schedulers. */
export function localDay(now: Date, tz: string): string {
  return localClock(now, tz).day
}

/** Digest-Datum (lokaler Tag der Zone) und Analyse-Datum (UTC-Tag) eines Laufs — Begründung im Modulkommentar. */
export function dayKeys(now: Date, tz: string): { digestDate: string; analysisDate: string } {
  return { digestDate: localDay(now, tz), analysisDate: now.toISOString().slice(0, 10) }
}
