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
  // Only track which emails are marked as sources (toggle ON)
  const [sourcesSet, setSourcesSet] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const toggleSource = (email: string) => {
    setSourcesSet(prev => {
      const next = new Set(prev)
      if (next.has(email)) {
        next.delete(email)
      } else {
        next.add(email)
      }
      return next
    })
  }

  const sourcesToAdd = emails.filter(e => sourcesSet.has(e.email))
  // All emails NOT toggled as source will be excluded
  const sendersToExclude = emails.filter(e => !sourcesSet.has(e.email))

  async function handleSave() {
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
        setSourcesSet(new Set())
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
    setSourcesSet(new Set())
  }

  if (emails.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[80vw] !max-w-[80vw] p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Weitere Newsletter gefunden
            </DialogTitle>
            <DialogDescription>
              Toggle AN = als Newsletter-Quelle hinzufügen. Nicht getoggelte Mails werden automatisch ausgeblendet.
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
                <Check className="h-3 w-3" />
                {sourcesToAdd.length} hinzufügen
              </Badge>
            )}
            <Badge variant="secondary" className="gap-1">
              <EyeOff className="h-3 w-3" />
              {sendersToExclude.length} ausblenden
            </Badge>
          </div>
        </div>

        {/* Email list - compact grid layout */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-3">
          <div className="grid gap-2">
            {emails.map((email) => {
              const isSource = sourcesSet.has(email.email)

              return (
                <div
                  key={email.email}
                  className={cn(
                    "flex items-center gap-4 rounded-lg border px-4 py-2 transition-colors",
                    isSource ? "border-green-500 bg-green-50" : "border-muted bg-muted/20 opacity-60"
                  )}
                >
                  {/* Toggle for adding as source */}
                  <Switch
                    checked={isSource}
                    onCheckedChange={() => toggleSource(email.email)}
                    className="data-[state=checked]:bg-green-600"
                  />

                  {/* Email info - compact */}
                  <div className="flex-1 min-w-0 flex items-center gap-3">
                    <span className={cn(
                      "font-medium text-sm truncate",
                      !isSource && "text-muted-foreground"
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

                  {/* Visual indicator for exclusion */}
                  {!isSource && (
                    <EyeOff className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
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
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Speichern
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
