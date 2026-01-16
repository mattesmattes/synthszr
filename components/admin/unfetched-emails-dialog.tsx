'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Loader2, Mail, Check, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UnfetchedEmail {
  email: string
  name: string
  count: number
  subjects: string[]
  latestDate: string
}

type EmailDecision = 'source' | 'excluded' | 'undecided'

interface UnfetchedEmailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  emails: UnfetchedEmail[]
  onComplete: (result: { sourcesAdded: number; sendersExcluded: number; newslettersFetched: number }) => void
}

export function UnfetchedEmailsDialog({
  open,
  onOpenChange,
  emails,
  onComplete
}: UnfetchedEmailsDialogProps) {
  const [decisions, setDecisions] = useState<Map<string, EmailDecision>>(new Map())
  const [saving, setSaving] = useState(false)

  const getDecision = (email: string): EmailDecision => decisions.get(email) || 'undecided'

  const setDecision = (email: string, decision: EmailDecision) => {
    setDecisions(prev => {
      const next = new Map(prev)
      if (decision === 'undecided') {
        next.delete(email)
      } else {
        next.set(email, decision)
      }
      return next
    })
  }

  const sourcesToAdd = emails.filter(e => getDecision(e.email) === 'source')
  const sendersToExclude = emails.filter(e => getDecision(e.email) === 'excluded')
  const hasChanges = sourcesToAdd.length > 0 || sendersToExclude.length > 0

  async function handleSave() {
    if (!hasChanges) {
      onOpenChange(false)
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/admin/manage-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          addSources: sourcesToAdd.map(e => ({ email: e.email, name: e.name })),
          excludeSenders: sendersToExclude.map(e => ({ email: e.email, name: e.name }))
        })
      })

      const result = await response.json()

      if (response.ok) {
        onComplete(result)
        onOpenChange(false)
        setDecisions(new Map())
      } else {
        alert('Fehler: ' + (result.error || 'Unbekannter Fehler'))
      }
    } catch (err) {
      console.error('Error saving decisions:', err)
      alert('Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  function handleSkip() {
    onOpenChange(false)
    setDecisions(new Map())
  }

  if (emails.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[80vw] max-w-[80vw] p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Weitere Newsletter gefunden
            </DialogTitle>
            <DialogDescription>
              Toggle = als Newsletter-Quelle hinzufügen. Klicke auf das Auge um dauerhaft auszublenden.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Summary bar */}
        <div className="flex items-center justify-between px-6 py-2 border-y bg-muted/30">
          <p className="text-sm text-muted-foreground">
            {emails.length} gefunden
          </p>
          <div className="flex gap-3 text-sm">
            {sourcesToAdd.length > 0 && (
              <Badge variant="default" className="gap-1 bg-green-600">
                {sourcesToAdd.length} hinzufügen
              </Badge>
            )}
            {sendersToExclude.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <EyeOff className="h-3 w-3" />
                {sendersToExclude.length} ausblenden
              </Badge>
            )}
          </div>
        </div>

        {/* Email list - compact grid layout */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-3">
          <div className="grid gap-2">
            {emails.map((email) => {
              const decision = getDecision(email.email)
              const isSource = decision === 'source'
              const isExcluded = decision === 'excluded'

              return (
                <div
                  key={email.email}
                  className={cn(
                    "flex items-center gap-4 rounded-lg border px-4 py-2 transition-colors",
                    isSource && "border-green-500 bg-green-50",
                    isExcluded && "border-muted bg-muted/30 opacity-50"
                  )}
                >
                  {/* Toggle for adding as source */}
                  <Switch
                    checked={isSource}
                    disabled={isExcluded}
                    onCheckedChange={(checked) => {
                      setDecision(email.email, checked ? 'source' : 'undecided')
                    }}
                    className="data-[state=checked]:bg-green-600"
                  />

                  {/* Email info - compact */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className={cn(
                      "font-medium text-sm truncate",
                      isExcluded && "line-through"
                    )}>
                      {email.name || email.email}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono truncate hidden sm:inline">
                      {email.email}
                    </span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {email.count}×
                    </Badge>
                  </div>

                  {/* Subject preview */}
                  {email.subjects.length > 0 && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px] hidden md:inline">
                      „{email.subjects[0]}"
                    </span>
                  )}

                  {/* Exclude button */}
                  <button
                    onClick={() => setDecision(email.email, isExcluded ? 'undecided' : 'excluded')}
                    className={cn(
                      "p-1.5 rounded hover:bg-muted transition-colors shrink-0",
                      isExcluded && "text-red-500"
                    )}
                    title={isExcluded ? "Wieder einblenden" : "Dauerhaft ausblenden"}
                  >
                    <EyeOff className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 border-t">
          <Button variant="ghost" onClick={handleSkip}>
            Überspringen
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Speichern...
              </>
            ) : hasChanges ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Speichern & Fetchen
              </>
            ) : (
              'Fertig'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
