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
import { Loader2, Mail, Plus, X, Check } from 'lucide-react'
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

  const toggleDecision = (email: string, targetDecision: EmailDecision) => {
    const current = getDecision(email)
    if (current === targetDecision) {
      setDecision(email, 'undecided')
    } else {
      setDecision(email, targetDecision)
    }
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
      <DialogContent className="max-w-2xl p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Weitere Newsletter gefunden
            </DialogTitle>
            <DialogDescription>
              Diese E-Mails wurden in deinen Newsstand-Labels gefunden, sind aber noch nicht als Quellen registriert.
              Wähle aus, welche als Newsletter-Quellen hinzugefügt werden sollen.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Summary bar */}
        <div className="flex items-center justify-between px-6 py-2 border-y bg-muted/30">
          <p className="text-sm text-muted-foreground">
            {emails.length} gefunden
          </p>
          <div className="flex gap-2 text-sm">
            {sourcesToAdd.length > 0 && (
              <Badge variant="default" className="gap-1">
                <Plus className="h-3 w-3" />
                {sourcesToAdd.length} hinzufügen
              </Badge>
            )}
            {sendersToExclude.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <X className="h-3 w-3" />
                {sendersToExclude.length} ausblenden
              </Badge>
            )}
          </div>
        </div>

        {/* Email list */}
        <div className="max-h-[50vh] overflow-y-auto px-6 py-3">
          <div className="space-y-2">
            {emails.map((email) => {
              const decision = getDecision(email.email)
              return (
                <div
                  key={email.email}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                    decision === 'source' && "border-green-500 bg-green-50",
                    decision === 'excluded' && "border-muted bg-muted/30 opacity-60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {email.name || email.email}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {email.count}× in Labels
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {email.email}
                    </p>
                    {email.subjects.length > 0 && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        „{email.subjects[0]}"
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant={decision === 'source' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => toggleDecision(email.email, 'source')}
                      title="Als Newsletter-Quelle hinzufügen"
                    >
                      <Plus className={cn("h-4 w-4", decision === 'source' && "text-white")} />
                    </Button>
                    <Button
                      variant={decision === 'excluded' ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => toggleDecision(email.email, 'excluded')}
                      title="Dauerhaft ausblenden"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
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
