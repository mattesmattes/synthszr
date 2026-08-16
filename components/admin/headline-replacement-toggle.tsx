'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Wand2, Loader2 } from 'lucide-react'

/**
 * Schaltet die Überschriften-Ersetzung scharf — sitzt in der Werkzeugleiste des
 * Editors, weil dort auch die Auswahl passiert.
 *
 * WAS DER SCHALTER TUT: Ist er an, wird die journalistische Variante des
 * Ghostwriters zur Überschrift des Abschnitts. Ist er aus, bleibt die
 * ursprünglich geschriebene stehen und die Vorschläge reihen sich in der
 * Auswahlleiste dahinter ein.
 *
 * WAS ER NICHT TUT: die Erzeugung abschalten. Die Vorschläge entstehen in
 * jedem Fall, sonst fehlten die Auswertungsdaten genau in der Anlaufzeit, in
 * der sie am meisten aussagen.
 *
 * Er wirkt auf KÜNFTIGE Läufe des Ghostwriters, nicht auf den offenen Artikel —
 * dessen Überschriften stehen längst im Dokument. Das sagt der Titeltext, weil
 * es sonst so aussieht, als bliebe der Klick wirkungslos.
 */
export function HeadlineReplacementToggle() {
  const [an, setAn] = useState<boolean | null>(null)
  const [laedt, setLaedt] = useState(false)

  useEffect(() => {
    fetch('/api/admin/headline-variants-config')
      .then((r) => r.json())
      .then((d) => setAn(d.replaceHeading === true))
      .catch(() => setAn(false))
  }, [])

  async function umlegen() {
    if (an === null || laedt) return
    setLaedt(true)
    const neu = !an
    try {
      const r = await fetch('/api/admin/headline-variants-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replaceHeading: neu }),
      })
      if (r.ok) setAn(neu)
    } finally {
      setLaedt(false)
    }
  }

  return (
    <Button
      type="button"
      variant={an ? 'secondary' : 'ghost'}
      size="sm"
      onClick={umlegen}
      disabled={an === null || laedt}
      title={
        an
          ? 'Neue Artikel bekommen die journalistische Variante als Überschrift. Klick schaltet zurück.'
          : 'Neue Artikel behalten die ursprüngliche Überschrift; die Vorschläge stehen zur Auswahl. Klick schaltet die Ersetzung scharf.'
      }
      className="gap-1.5"
    >
      {laedt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
      <span className="text-xs">
        Headline-Ersetzung {an === null ? '…' : an ? 'an' : 'aus'}
      </span>
    </Button>
  )
}
