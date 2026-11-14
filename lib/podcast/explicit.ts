/**
 * Explicit-Kennzeichnung einer Folge (Betreiber 2026-11-14: derbere Sprache
 * erlaubt, F-Wort eingeschlossen). Apple Podcasts und Spotify verlangen dann
 * die Kennzeichnung „explicit"; Podigee nimmt sie je Episode als Feld
 * `explicit` (boolean, EpisodeCreate laut https://app.podigee.com/api/v1/docs).
 *
 * Gezählt werden nur starke Wörter; „damn" oder „hell" machen eine Folge
 * nicht explicit. Ohne lesbares Skript gilt die Folge vorsichtshalber als
 * explicit: Eine fälschlich gekennzeichnete Folge kostet nichts, eine
 * fehlende Kennzeichnung kann die Folge bei Apple sperren.
 */
const STRONG_EN = /\b(fuck\w*|motherfuck\w*|shit\w*|bullshit\w*|asshole\w*|dickhead\w*|bitch\w*|cock\w*|pissed|piss)\b/i
const STRONG_DE = /\b(scheiß\w*|scheiss\w*|verfickt\w*|fick\w*|arschloch\w*|wichser\w*|fotze\w*|bullshit)\b/i

export function containsExplicitLanguage(script: string | null | undefined): boolean {
  if (!script) return true
  const spoken = script
    .split('---MOMENTS---')[0]
    .split('\n')
    .filter((l) => /^(HOST|GUEST)\b/i.test(l.trim()))
    .map((l) => l.replace(/^(HOST|GUEST)(?:\s*\(overlapping\))?\s*:\s*(?:\[[^\]]*\]\s*)?/i, ''))
    .join(' ')
  return STRONG_EN.test(spoken) || STRONG_DE.test(spoken)
}
