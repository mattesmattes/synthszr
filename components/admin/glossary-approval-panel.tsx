// components/admin/glossary-approval-panel.tsx
'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import type { GlossaryCandidate } from '@/lib/glossary/types'

const ORIGIN_LABELS: Record<GlossaryCandidate['origin'], string> = {
  tag: '{lex:}-Tag',
  match: 'Erwähnung im Text',
  new: 'Neu erkannt',
}

interface GlossaryApprovalPanelProps {
  candidates: GlossaryCandidate[]
  value: string[]
  onChange: (slugs: string[]) => void
}

/**
 * Freigabe-Panel für Lexikon-Begriffskandidaten (Task 12): der Editor listet
 * hier `pending_glossary_terms`, bestätigte Slugs gehen beim Speichern als
 * `confirmedGlossarySlugs` mit — die PATCH-Route veröffentlicht die Drafts
 * und verlinkt sie im Artikeltext (Task 11).
 *
 * Vorauswahl bewusst NICHT nur nach `origin`: ein {lex:}-Tag kann auf einen in
 * DIESEM Tick frisch generierten Begriff zeigen (`isNewlyGenerated=true`) —
 * ungeprüfter LLM-Text, den noch kein Mensch gelesen hat. Würde man den allein
 * wegen origin='tag' vorauswählen, ginge er beim nächsten normalen Speichern
 * live, ohne dass ihn je jemand kontrolliert hat. Deshalb ist nur
 * origin='tag' UND isNewlyGenerated=false vorausgewählt; ein frischer
 * Tag-Kandidat bekommt dieselbe offene Checkbox wie ein 'new'-Kandidat und
 * den „neu generiert"-Hinweis, damit sichtbar bleibt, WARUM er nicht wie ein
 * gewöhnlicher Tag vorausgewählt ist.
 */
export function GlossaryApprovalPanel({ candidates, value, onChange }: GlossaryApprovalPanelProps) {
  if (candidates.length === 0) return null

  function toggle(slug: string, checked: boolean) {
    onChange(checked ? [...value, slug] : value.filter((s) => s !== slug))
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-medium text-sm">Lexikon-Begriffe zur Freigabe</h3>
        <p className="text-xs text-muted-foreground">
          Bestätigte Begriffe werden beim Speichern veröffentlicht und im Artikeltext verlinkt.
          Bei „Text wird beim Speichern erzeugt“ entsteht der Erklärtext erst dann — pro
          Speichervorgang höchstens drei, der Rest bleibt für den nächsten vorgemerkt.
        </p>
      </div>

      <div className="space-y-1.5">
        {candidates.map((c) => (
          <div key={c.slug} className="flex items-start gap-3 p-2 bg-muted/50 rounded">
            <Checkbox
              id={`glossary-${c.slug}`}
              checked={value.includes(c.slug)}
              onCheckedChange={(checked) => toggle(c.slug, checked === true)}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Label htmlFor={`glossary-${c.slug}`} className="font-medium text-sm cursor-pointer">
                  {c.name}
                </Label>
                <Badge variant="outline" className="text-[10px] px-1.5">
                  {ORIGIN_LABELS[c.origin]}
                </Badge>
                {c.isNewlyGenerated && (
                  <Badge className="text-[10px] px-1.5 border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">
                    neu generiert · ungeprüft
                  </Badge>
                )}
                {c.needsGeneration && (
                  <Badge variant="secondary" className="text-[10px] px-1.5">
                    Text wird beim Speichern erzeugt
                  </Badge>
                )}
              </div>
              {c.matchedText && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  gefunden als „{c.matchedText}"
                </p>
              )}
              {c.summary && (
                <p className="text-xs text-muted-foreground mt-0.5">{c.summary}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
