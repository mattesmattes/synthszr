/**
 * Die Torwaechter der Tageskette: Wann gilt ein Schritt als erledigt, und wann
 * WARTET der naechste, statt den Tag zu ueberspringen?
 *
 * PROD-BEFUND 2026-08-23: Der Newsletter-Abruf lief um 03:46 und sammelte NULL
 * Artikel — die Newsletter kamen an dem Tag erst gegen 07:00. Der Scheduler
 * verbuchte den leeren Lauf als Erfolg (`if (fetchResult.success)
 * markTaskRun(...)`), denn null Artikel sind formal kein Fehler. Danach sperrte
 * hasRunToday jeden weiteren Versuch fuer den restlichen Tag, obwohl der Cron
 * alle 15 Minuten weiterlief und die 07:00-Welle muehelos erwischt haette.
 * Ohne Quellmaterial fiel die Tagesanalyse aus und mit ihr der Artikel.
 *
 * Kernregel hier: Ein Schritt gilt nur als erledigt, wenn er ETWAS BEWIRKT hat.
 * Sonst bleibt er offen und wird beim naechsten Tick wiederholt.
 */
import { describe, expect, it } from 'vitest'
import { isStepComplete, dependencyGate } from '@/lib/scheduler/gating'

describe('isStepComplete', () => {
  it('gilt NICHT als erledigt, wenn nichts eingesammelt wurde', () => {
    // Genau der Fall vom 2026-08-23.
    expect(isStepComplete({ success: true, produced: 0 })).toBe(false)
  })

  it('gilt als erledigt, sobald etwas ankam', () => {
    expect(isStepComplete({ success: true, produced: 16 })).toBe(true)
  })

  it('gilt bei einem Fehler nie als erledigt', () => {
    expect(isStepComplete({ success: false, produced: 99 })).toBe(false)
  })

  it('behandelt Schritte ohne Mengenangabe weiter nach success', () => {
    // Nicht jeder Schritt produziert zaehlbare Dinge (z. B. Aufraeumarbeiten).
    expect(isStepComplete({ success: true })).toBe(true)
    expect(isStepComplete({ success: false })).toBe(false)
  })
})

describe('dependencyGate', () => {
  it('laesst durch, wenn die Vorstufe fertig ist', () => {
    expect(dependencyGate('completed')).toBe('ready')
    expect(dependencyGate('already_ran')).toBe('ready')
  })

  it('WARTET statt zu ueberspringen, wenn die Vorstufe noch nicht so weit ist', () => {
    // Der Unterschied ist nicht kosmetisch: 'waiting' heisst, der naechste Tick
    // versucht es erneut — der Tag ist nicht verloren.
    expect(dependencyGate('waiting_for_sources')).toBe('waiting')
    expect(dependencyGate('error')).toBe('waiting')
    expect(dependencyGate(undefined)).toBe('waiting')
    expect(dependencyGate('not_scheduled')).toBe('waiting')
  })
})
