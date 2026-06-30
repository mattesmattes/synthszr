/** Halbwertszeit der Momentum-Gewichtung: eine Mention zählt nach 14 Tagen halb. */
const HALFLIFE_DAYS = 14

/**
 * Momentum-Score (MVP): recency-gewichtete Summe der Mentions. Jüngere Mentions
 * zählen mehr (exponentieller Decay, Halbwertszeit 14 Tage). Roher Wert (≥0),
 * der die Sortierung bestimmt; für die Anzeige via toDisplayScore() auf 0–100
 * normalisiert. Sentiment/Features fließen erst in 1b-iii/1c ein.
 */
export function momentumScore(mentionDates: Array<string | Date>, now: Date): number {
  let m = 0
  for (const d of mentionDates) {
    const ageDays = (now.getTime() - new Date(d).getTime()) / 86_400_000
    if (!isFinite(ageDays) || ageDays < 0) continue // null/ungültige/Zukunfts-Daten ignorieren
    m += Math.pow(0.5, ageDays / HALFLIFE_DAYS)
  }
  return m
}

/** Normalisiert ein rohes Momentum relativ zum Spitzenreiter auf 0–100 (Anzeige). */
export function toDisplayScore(momentum: number, maxMomentum: number): number {
  if (maxMomentum <= 0) return 0
  return Math.round((momentum / maxMomentum) * 100)
}

/**
 * Trend aus der ERWÄHNUNGS-RATE — Erwähnungen der letzten 7 Tage vs. der 7 Tage
 * davor. Bewusst NICHT aus dem recency-gewichteten Momentum-Wert abgeleitet: der
 * klingt ohne neue Erwähnungen exponentiell ab, weshalb fast jedes Produkt
 * fälschlich „fallend" zeigte. Produkte ohne nennenswerte aktuelle Aktivität
 * gelten als stagnierend, nicht als fallend.
 */
export function momentumTrend(mentionDates: Array<string | Date>, now: Date): 'up' | 'down' | 'flat' {
  const day = 86_400_000
  let recent = 0
  let prev = 0
  for (const d of mentionDates) {
    const age = (now.getTime() - new Date(d).getTime()) / day
    if (!isFinite(age) || age < 0 || age > 14) continue
    if (age <= 7) recent++
    else prev++
  }
  // Zu wenig aktuelle Aktivität (≤1 Erwähnung in 14 Tagen) → stabil, nicht fallend.
  if (recent + prev < 2) return 'flat'
  if (recent >= prev * 1.25) return 'up'
  if (recent <= prev * 0.75) return 'down'
  return 'flat'
}

/**
 * Rekonstruiert den Momentum-Verlauf aus den Mention-Daten: an `points`
 * gleichmäßigen Stützstellen über die letzten `days` Tage der Momentum-Wert,
 * wie er an diesem Stichtag gewesen wäre (nur Mentions bis dahin, recency-
 * gewichtet relativ zum Stichtag). Braucht keine Snapshots.
 */
export function momentumHistory(
  mentionDates: Array<string | Date>, now: Date, days = 21, points = 12,
): Array<{ t: number; value: number }> {
  const ms = mentionDates.map((d) => new Date(d).getTime()).filter((t) => isFinite(t))
  const span = days * 86_400_000
  const out: Array<{ t: number; value: number }> = []
  for (let i = 0; i < points; i++) {
    const t = now.getTime() - span * (1 - i / (points - 1)) // now-days … now
    let m = 0
    for (const dt of ms) {
      const ageDays = (t - dt) / 86_400_000
      if (ageDays < 0) continue // Mention liegt nach dem Stichtag
      m += Math.pow(0.5, ageDays / HALFLIFE_DAYS)
    }
    out.push({ t, value: m })
  }
  return out
}
