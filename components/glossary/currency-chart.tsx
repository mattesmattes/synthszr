'use client'

import { useState } from 'react'
import type { KursPunkt } from '@/lib/currency/history'

interface Props {
  punkte: KursPunkt[]
  code: string
  lang: string
  labels: { ueberschrift: string; spanne: string; jahre: string; monate: string }
}

/** Auswahl in Monaten — 3 Jahre, 1 Jahr, 3 Monate. */
const BEREICHE = [36, 12, 3]

export function CurrencyChart({ punkte, code, lang, labels }: Props) {
  const [monate, setMonate] = useState(36)
  if (punkte.length < 2) return null

  // Zuschnitt über den Datumsstring statt über Date-Objekte: die Reihe ist
  // aufsteigend sortiert, und ein Stringvergleich auf YYYY-MM-DD ist
  // gleichbedeutend mit dem Datumsvergleich — ohne Zeitzonenfragen.
  const letzter = punkte[punkte.length - 1]
  const grenze = verschiebeMonate(letzter.t, -monate)
  const sichtbar = punkte.filter((p) => p.t >= grenze)
  if (sichtbar.length < 2) return null

  const W = 600, H = 120, pad = 6
  const werte = sichtbar.map((p) => p.v)
  const roh = { min: Math.min(...werte), max: Math.max(...werte) }

  // HIER WEICHT DIESER CHART VOM MOMENTUM-CHART AB, und zwar notwendig: dort
  // läuft die Skala von 0 bis max, weil ein Momentum-Score bei 0 beginnt. Ein
  // Wechselkurs tut das nicht — er schwankt zwischen etwa 7 und 8,5. Von 0
  // aus gezeichnet wäre die Kurve eine waagerechte Linie am oberen Rand und
  // die ganze Bewegung unsichtbar.
  //
  // Deshalb Skala von Tief bis Hoch, mit 8 % Luft nach beiden Seiten, damit
  // die Kurve die Ränder nicht berührt. Der Preis dafür: die Fläche darunter
  // beginnt nicht bei null. Das ist bei Kursdiagrammen üblich, muss aber
  // ausgewiesen werden — dafür steht die Spanne unter dem Bild.
  const luft = (roh.max - roh.min) * 0.08 || roh.max * 0.02
  const min = roh.min - luft
  const spanne = (roh.max + luft) - min || 1

  const x = (i: number) => pad + (i / (sichtbar.length - 1)) * (W - 2 * pad)
  const y = (v: number) => pad + (1 - (v - min) / spanne) * (H - 2 * pad)

  const linie = sichtbar.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const flaeche = `${pad},${H - pad} ${linie} ${W - pad},${H - pad}`

  const pille = (aktiv: boolean) =>
    `px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
      aktiv
        ? 'bg-foreground text-background border-foreground'
        : 'border-border text-foreground/80 hover:border-foreground'
    }`

  return (
    <div className="not-prose mb-8">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {labels.ueberschrift}
        </span>
        <div className="flex gap-1">
          {BEREICHE.map((m) => (
            <button key={m} onClick={() => setMonate(m)} className={pille(monate === m)}>
              {m >= 12 ? `${m / 12} ${labels.jahre}` : `${m} ${labels.monate}`}
            </button>
          ))}
        </div>
      </div>

      {/* Gleiche Machart wie die Synthszr Charts: Neonfläche, Linie in der
          Textfarbe. stroke="currentColor" statt eines festen Werts — sonst wäre
          die Linie im Dunkelmodus schwarz auf schwarz (SVG löst var() in
          Präsentationsattributen nicht auf, s. rankings/single-momentum-chart). */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full text-foreground"
        style={{ height: H }}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${labels.ueberschrift} ${code}`}
      >
        <polygon points={flaeche} fill="#CCFF00" opacity={0.4} />
        <polyline
          points={linie}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="flex justify-between text-[10px] text-muted-foreground/70 mt-1">
        <span>{kurzesDatum(sichtbar[0].t, lang)}</span>
        <span>
          {labels.spanne} {zahl(roh.min, lang)} – {zahl(roh.max, lang)} {code}
        </span>
        <span>{kurzesDatum(letzter.t, lang)}</span>
      </div>
    </div>
  )
}

/** Monate auf einem YYYY-MM-DD-String verschieben, ohne Date und ohne
 *  Zeitzone. Ein Überlauf im Tag ist unschädlich: die Grenze wird nur
 *  verglichen, nicht angezeigt. */
function verschiebeMonate(iso: string, delta: number): string {
  const [j, m, t] = iso.split('-').map(Number)
  const gesamt = j * 12 + (m - 1) + delta
  const nj = Math.floor(gesamt / 12)
  const nm = (gesamt % 12) + 1
  return `${nj}-${String(nm).padStart(2, '0')}-${String(t).padStart(2, '0')}`
}

function kurzesDatum(iso: string, lang: string): string {
  const [j, m] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    month: '2-digit', year: 'numeric',
  }).format(new Date(j, m - 1, 1))
}

function zahl(v: number, lang: string): string {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v)
}
