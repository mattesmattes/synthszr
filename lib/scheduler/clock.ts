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

/**
 * ISO-Zeitpunkt von 00:00 des lokalen Tages von `now` in der Zone `tz` —
 * zonen- und sommerzeitbewusst, ohne Bibliothek: vom UTC-Mitternachtsschätzwert
 * aus wird der lokale Versatz gemessen und abgezogen (konvergiert in ein bis
 * zwei Schritten, auch über eine Zeitumstellung hinweg).
 * Befund 2026-11-01: die Fetch-Ampel rechnete „heute" mit festem +02:00.
 */
export function localMidnightIso(now: Date, tz: string): string {
  const day = localDay(now, tz)
  const [y, m, d] = day.split('-').map(Number)
  const dayUtcMs = Date.UTC(y, m - 1, d)
  let guess = new Date(dayUtcMs)
  for (let i = 0; i < 3; i++) {
    const c = localClock(guess, tz)
    const [cy, cm, cd] = c.day.split('-').map(Number)
    const dayDiffMin = Math.round((Date.UTC(cy, cm - 1, cd) - dayUtcMs) / 60_000)
    const diffMin = dayDiffMin + c.hour * 60 + c.minute
    if (diffMin === 0) break
    guess = new Date(guess.getTime() - diffMin * 60_000)
  }
  return guess.toISOString()
}
