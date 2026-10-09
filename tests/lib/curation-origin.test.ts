/**
 * Herkunft je Queue-Item aus den queue_item_events ableiten.
 *
 * BEFUND 2026-10-06 (Spec „Herkunft und Hand-Begriff"): `status='selected'`
 * setzen vier Akteure — Admin-Route, Panel-Annahme, Techmeme-Job, Nachtlauf —
 * und die Zeile in news_queue kennt keinen davon (`selected_at` ja, Setzer
 * nein). Am 03.10. ließ der Betreiber 89 von 100 Techmeme-Items verfallen;
 * wer die als „vom Betreiber gewählt" behandelt, baut die Hand-Invariante auf
 * Sand. Deshalb: Herkunft = Akteur des jüngsten Events mit to_status='selected',
 * Fallback über metadata für Bestandszeilen ohne Event.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { QueueEventActor, QueueEventName, QueueEventRow } from '@/lib/news-queue/events'
import { isConfirmedByOperator, isHandItem, originOf } from '@/lib/curation/origin'

const ITEM = '11111111-1111-4111-8111-111111111111'

let seq = 0

/** Event-Zeile in Einfüge-Reihenfolge: `at` und `id` steigen mit jedem Aufruf. */
function ev(
  actor: QueueEventActor,
  event: QueueEventName,
  to_status: string | null = null,
  extra: Partial<QueueEventRow> = {}
): QueueEventRow {
  seq += 1
  return {
    id: seq,
    queue_item_id: ITEM,
    event,
    actor,
    from_status: null,
    to_status,
    from_role: null,
    to_role: null,
    reason: null,
    run_id: null,
    at: new Date(Date.UTC(2026, 9, 6, 6, 0, seq)).toISOString(),
    ...extra,
  }
}

const item = (metadata: Record<string, unknown> | null = {}) => ({ id: ITEM, metadata })

beforeEach(() => {
  seq = 0
})

describe('originOf — Akteur des jüngsten to_status=selected-Events', () => {
  it('operator: Admin-Route select', () => {
    expect(originOf(item(), [ev('operator', 'select', 'selected')])).toBe('operator')
  })

  it('techmeme: techmeme_promote', () => {
    expect(originOf(item({ techmeme: true }), [ev('techmeme', 'techmeme_promote', 'selected')])).toBe('techmeme')
  })

  it('agent: select durch den Protokollanten', () => {
    expect(originOf(item(), [ev('agent', 'select', 'selected', { run_id: 'run-1' })])).toBe('agent')
  })

  it('pipeline: select im Nachtlauf', () => {
    expect(originOf(item(), [ev('pipeline', 'select', 'selected')])).toBe('pipeline')
  })

  it('nimmt das JÜNGSTE selected-Event, nicht das erste', () => {
    // Techmeme stellt ein, Betreiber setzt zurück und wählt später selbst —
    // die zweite Wahl ist die Herkunft.
    const events = [
      ev('techmeme', 'techmeme_promote', 'selected'),
      ev('operator', 'reset', 'pending'),
      ev('operator', 'select', 'selected'),
    ]
    expect(originOf(item({ techmeme: true }), events)).toBe('operator')
  })

  it('ignoriert Events ohne to_status=selected bei der Herkunft', () => {
    // Ein Operator-reset nach dem Pipeline-select ändert die Herkunft nicht.
    const events = [ev('pipeline', 'select', 'selected'), ev('operator', 'reset', 'pending')]
    expect(originOf(item(), events)).toBe('pipeline')
  })

  it('Fallback ohne Events: metadata.curation.run_id → agent', () => {
    expect(originOf(item({ curation: { run_id: 'run-7' } }), [])).toBe('agent')
  })

  it('Fallback ohne Events: metadata.techmeme === true → techmeme', () => {
    expect(originOf(item({ techmeme: true, techmeme_story: 'x' }), [])).toBe('techmeme')
  })

  it('Fallback ohne Events: sonst operator (auch bei metadata null oder {})', () => {
    expect(originOf(item({}), [])).toBe('operator')
    expect(originOf(item(null), [])).toBe('operator')
  })

  it('Fallback greift auch, wenn Events da sind, aber keines selected setzt', () => {
    expect(originOf(item({ techmeme: true }), [ev('operator', 'relabel', null, { from_role: null, to_role: 'topic' })])).toBe('techmeme')
  })

  it('Fallback: curation.run_id schlägt techmeme-Marker', () => {
    // Der Protokollant kann ein Techmeme-Item in seinen Lauf aufnehmen; dann
    // ist der Lauf die Herkunft, nicht der Techmeme-Job.
    expect(originOf(item({ techmeme: true, curation: { run_id: 'run-9' } }), [])).toBe('agent')
  })

  it('Fallback: leerer oder fehlender run_id zählt nicht als agent (Entscheidung 3)', () => {
    expect(originOf(item({ curation: { run_id: '' } }), [])).toBe('operator')
    expect(originOf(item({ curation: {} }), [])).toBe('operator')
    expect(originOf(item({ curation: 'run-1' }), [])).toBe('operator')
  })
})

describe('isConfirmedByOperator — Operator-Event NACH dem Herkunfts-Event', () => {
  it('relabel durch den Betreiber nach techmeme_promote bestätigt', () => {
    const events = [
      ev('techmeme', 'techmeme_promote', 'selected'),
      ev('operator', 'relabel', null, { from_role: 'topic', to_role: 'cover_story' }),
    ]
    expect(isConfirmedByOperator(events)).toBe(true)
  })

  it('panel_accept nach pipeline-select bestätigt', () => {
    const events = [
      ev('pipeline', 'select', 'selected'),
      ev('operator', 'panel_accept', null, { run_id: 'run-3' }),
    ]
    expect(isConfirmedByOperator(events)).toBe(true)
  })

  it('select durch den Betreiber nach agent-select bestätigt (select ohne Statuswechsel)', () => {
    // Konstruierter Fall: der Task-5-Hook schreibt select-Events nur für
    // pending→selected, ein select OHNE to_status='selected' kommt also nur von
    // einem anderen Schreiber (Phase-2-Protokollant, Hand-Insert). Es darf die
    // Herkunft nicht umschreiben, zählt aber laut Vertrag 2.3 als Bestätigung
    // (Entscheidung 2) — die Handlung des Betreibers zählt.
    const events = [
      ev('agent', 'select', 'selected', { run_id: 'run-4' }),
      ev('operator', 'select', null, { from_status: 'selected' }),
    ]
    expect(isConfirmedByOperator(events)).toBe(true)
  })

  it('Operator-Event VOR dem Herkunfts-Event zählt NICHT', () => {
    // Der Betreiber hat das Item früher einmal gelabelt, dann wurde es
    // zurückgesetzt und vom Nachtlauf neu gewählt — seine alte Handlung galt
    // einem anderen Zustand.
    const events = [
      ev('operator', 'relabel', null, { from_role: null, to_role: 'topic' }),
      ev('pipeline', 'reset', 'pending'),
      ev('pipeline', 'select', 'selected'),
    ]
    expect(isConfirmedByOperator(events)).toBe(false)
  })

  it('Operator-reset oder -skip nach dem Herkunfts-Event ist KEINE Bestätigung', () => {
    // Zurücksetzen oder Überspringen ist das Gegenteil einer Bestätigung.
    expect(isConfirmedByOperator([ev('pipeline', 'select', 'selected'), ev('operator', 'reset', 'pending')])).toBe(false)
    expect(isConfirmedByOperator([ev('pipeline', 'select', 'selected'), ev('operator', 'skip', 'skipped')])).toBe(false)
    expect(isConfirmedByOperator([ev('pipeline', 'select', 'selected'), ev('operator', 'remove', 'pending')])).toBe(false)
  })

  it('panel_reject ist keine Bestätigung', () => {
    expect(isConfirmedByOperator([ev('pipeline', 'select', 'selected'), ev('operator', 'panel_reject', null)])).toBe(false)
  })

  it('relabel durch pipeline oder agent bestätigt nicht', () => {
    expect(isConfirmedByOperator([ev('techmeme', 'techmeme_promote', 'selected'), ev('agent', 'relabel', null)])).toBe(false)
    expect(isConfirmedByOperator([ev('techmeme', 'techmeme_promote', 'selected'), ev('pipeline', 'relabel', null)])).toBe(false)
  })

  it('ohne Herkunfts-Event zählt ein Operator-relabel als Bestätigung', () => {
    // Bestandszeile vor Phase 0: Techmeme hat sie ohne Event eingestellt, der
    // Betreiber gibt ihr nach Task 6 ein Label — „ein Techmeme-Item, dem er ein
    // Label gegeben hat, ist eines" (Spec).
    expect(isConfirmedByOperator([ev('operator', 'relabel', null, { to_role: 'topic' })])).toBe(true)
  })

  it('leere Event-Liste: nicht bestätigt', () => {
    expect(isConfirmedByOperator([])).toBe(false)
  })
})

describe('isHandItem — Herkunft operator ODER bestätigt', () => {
  it('operator-select → Hand-Item', () => {
    expect(isHandItem(item(), [ev('operator', 'select', 'selected')])).toBe(true)
  })

  it('unberührtes Techmeme-Item → kein Hand-Item', () => {
    expect(isHandItem(item({ techmeme: true }), [ev('techmeme', 'techmeme_promote', 'selected')])).toBe(false)
  })

  it('Techmeme-Item mit Operator-relabel danach → Hand-Item', () => {
    const events = [
      ev('techmeme', 'techmeme_promote', 'selected'),
      ev('operator', 'relabel', null, { from_role: 'topic', to_role: 'cover_story' }),
    ]
    expect(isHandItem(item({ techmeme: true }), events)).toBe(true)
  })

  it('agent-select mit panel_accept danach → Hand-Item', () => {
    const events = [ev('agent', 'select', 'selected', { run_id: 'run-5' }), ev('operator', 'panel_accept', null, { run_id: 'run-5' })]
    expect(isHandItem(item({ curation: { run_id: 'run-5' } }), events)).toBe(true)
  })

  it('pipeline-select ohne Operator-Event → kein Hand-Item', () => {
    expect(isHandItem(item(), [ev('pipeline', 'select', 'selected')])).toBe(false)
  })

  it('select nach Reset durch den Betreiber → Hand-Item (Herkunft wechselt)', () => {
    const events = [
      ev('techmeme', 'techmeme_promote', 'selected'),
      ev('operator', 'reset', 'pending'),
      ev('operator', 'select', 'selected'),
    ]
    expect(isHandItem(item({ techmeme: true }), events)).toBe(true)
  })

  it('operator-select, dann stuck_reset und pipeline-select → kein Hand-Item mehr (Entscheidung 2)', () => {
    // Bewusste Konsequenz der Jüngstes-Event-Regel: die Wahl des Betreibers
    // galt dem Zustand vor dem Reset; die neue Wahl hat der Nachtlauf getroffen.
    // Ein selected→selected-select ohne Reset dazwischen kann der Task-5-Hook
    // nicht erzeugen (Filter .eq('status','pending')).
    const events = [
      ev('operator', 'select', 'selected'),
      ev('pipeline', 'stuck_reset', 'pending', { from_status: 'selected' }),
      ev('pipeline', 'select', 'selected', { from_status: 'pending' }),
    ]
    expect(originOf(item(), events)).toBe('pipeline')
    expect(isHandItem(item(), events)).toBe(false)
  })

  it('Fallback ohne Events: Bestandszeile ohne Marker → Hand-Item', () => {
    expect(isHandItem(item({}), [])).toBe(true)
  })

  it('Fallback ohne Events: Techmeme-Marker → kein Hand-Item', () => {
    expect(isHandItem(item({ techmeme: true }), [])).toBe(false)
  })

  it('Fallback ohne Events: curation.run_id → kein Hand-Item', () => {
    expect(isHandItem(item({ curation: { run_id: 'run-2' } }), [])).toBe(false)
  })
})

describe('Mehrfach gewählt am selben Tag (Review Focus 3: select → reset-item → erneut select)', () => {
  // WARUM eigener Block: der Tag eines Items kann mehrere Herkunfts-Events
  // tragen — Nachtlauf wählt, Betreiber entfernt es per reset-item (`remove`)
  // aus dem Entwurf, nimmt es im Panel wieder an. Die Panel-Annahme schreibt
  // ZWEI Operator-Events: `panel_accept` (recordFeedback) und `select`
  // (selectItemsForArticle). Die Route ruft heute recordFeedback zuerst
  // (`ranking-feedback/route.ts:18` vor `:23`); getestet werden beide
  // Reihenfolgen, damit ein Umbau der Route das Ergebnis nicht kippt.

  it('pipeline select → operator remove → panel_accept + select (Route-Reihenfolge) → Hand-Item', () => {
    const events = [
      ev('pipeline', 'select', 'selected', { from_status: 'pending' }),
      ev('operator', 'remove', 'pending', { from_status: 'selected', reason: 'draft_remove' }),
      ev('operator', 'panel_accept', null, { run_id: 'run-6' }),
      ev('operator', 'select', 'selected', { from_status: 'pending' }),
    ]
    // Herkunft = jüngstes to_status=selected-Event = der Operator-select.
    expect(originOf(item(), events)).toBe('operator')
    expect(isHandItem(item(), events)).toBe(true)
  })

  it('pipeline select → operator remove → select + panel_accept (umgekehrt) → Hand-Item', () => {
    const events = [
      ev('pipeline', 'select', 'selected', { from_status: 'pending' }),
      ev('operator', 'remove', 'pending', { from_status: 'selected', reason: 'draft_remove' }),
      ev('operator', 'select', 'selected', { from_status: 'pending' }),
      ev('operator', 'panel_accept', null, { run_id: 'run-6' }),
    ]
    expect(originOf(item(), events)).toBe('operator')
    // panel_accept liegt hier NACH dem Herkunfts-Event und bestätigt zusätzlich.
    expect(isConfirmedByOperator(events)).toBe(true)
    expect(isHandItem(item(), events)).toBe(true)
  })

  it('operator select → operator remove → pipeline select → kein Hand-Item', () => {
    // Der Betreiber hat das Item gewählt und wieder entfernt; danach hat der
    // Nachtlauf es neu gewählt. Der alte Operator-select liegt VOR dem
    // Herkunfts-Event und zählt nicht als Bestätigung; `remove` ist ohnehin
    // keine (CONFIRMING_EVENTS).
    const events = [
      ev('operator', 'select', 'selected', { from_status: 'pending' }),
      ev('operator', 'remove', 'pending', { from_status: 'selected', reason: 'draft_remove' }),
      ev('pipeline', 'select', 'selected', { from_status: 'pending' }),
    ]
    expect(originOf(item(), events)).toBe('pipeline')
    expect(isConfirmedByOperator(events)).toBe(false)
    expect(isHandItem(item(), events)).toBe(false)
  })
})
