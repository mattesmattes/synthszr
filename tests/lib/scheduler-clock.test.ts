/**
 * Zeitplan-Zeitzone (2026-10-18): der Scheduler rechnet Uhrzeit, Tagesmarke
 * und Digest-Datum in der konfigurierten IANA-Zone, das Analyse-Fenster
 * bleibt bei UTC-Tagen. Die Testdaten liegen bewusst um den 25.10.2026, den
 * Tag des EU-Sommerzeit-Endes (01:00 UTC), und den 01.11.2026 (US-Ende).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCHEDULE_TIMEZONE, dayKeys, isValidTimeZone, localClock, localDay } from '@/lib/scheduler/clock'

describe('localClock', () => {
  it('Berlin: Sommerzeit am 24.10., Normalzeit am 26.10.', () => {
    expect(localClock(new Date('2026-10-24T02:15:00Z'), 'Europe/Berlin')).toEqual({ hour: 4, minute: 15, day: '2026-10-24' })
    expect(localClock(new Date('2026-10-26T02:15:00Z'), 'Europe/Berlin')).toEqual({ hour: 3, minute: 15, day: '2026-10-26' })
  })

  it('Shanghai: 20:15 UTC ist 04:15 des Folgetags', () => {
    expect(localClock(new Date('2026-10-25T20:15:00Z'), 'Asia/Shanghai')).toEqual({ hour: 4, minute: 15, day: '2026-10-26' })
  })

  it('Auckland (NZDT, UTC+13) und Los Angeles (PDT, UTC−7)', () => {
    expect(localClock(new Date('2026-10-25T15:00:00Z'), 'Pacific/Auckland')).toEqual({ hour: 4, minute: 0, day: '2026-10-26' })
    expect(localClock(new Date('2026-10-25T11:00:00Z'), 'America/Los_Angeles')).toEqual({ hour: 4, minute: 0, day: '2026-10-25' })
  })

  it('Mitternacht ist Stunde 0, nicht 24', () => {
    expect(localClock(new Date('2026-10-25T23:00:00Z'), 'Europe/Berlin').hour).toBe(0)
    expect(localClock(new Date('2026-10-25T16:00:00Z'), 'Asia/Shanghai')).toEqual({ hour: 0, minute: 0, day: '2026-10-26' })
  })
})

describe('localDay / isValidTimeZone', () => {
  it('localDay liefert das lokale Datum der Zone', () => {
    expect(localDay(new Date('2026-10-25T23:30:00Z'), 'Europe/Berlin')).toBe('2026-10-26')
    expect(localDay(new Date('2026-10-25T23:30:00Z'), 'America/New_York')).toBe('2026-10-25')
  })

  it('erkennt gueltige IANA-Namen, lehnt Unsinn ab, Default ist Berlin', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
    expect(DEFAULT_SCHEDULE_TIMEZONE).toBe('Europe/Berlin')
  })
})

describe('dayKeys — Digest-Datum lokal, Analyse-Fenster in UTC', () => {
  it('Berlin am Morgen: beide Daten gleich', () => {
    expect(dayKeys(new Date('2026-10-25T02:15:00Z'), 'Europe/Berlin')).toEqual({ digestDate: '2026-10-25', analysisDate: '2026-10-25' })
  })

  it('Shanghai-Nachtlauf: Digest auf den lokalen Folgetag, Analyse-Fenster auf den UTC-Tag — keine Kollision mit dem Berliner Digest desselben Tages', () => {
    expect(dayKeys(new Date('2026-10-25T20:15:00Z'), 'Asia/Shanghai')).toEqual({ digestDate: '2026-10-26', analysisDate: '2026-10-25' })
  })

  it('Auckland: wie Shanghai; Los Angeles: beide gleich', () => {
    expect(dayKeys(new Date('2026-10-25T15:00:00Z'), 'Pacific/Auckland')).toEqual({ digestDate: '2026-10-26', analysisDate: '2026-10-25' })
    expect(dayKeys(new Date('2026-10-25T11:00:00Z'), 'America/Los_Angeles')).toEqual({ digestDate: '2026-10-25', analysisDate: '2026-10-25' })
  })
})
