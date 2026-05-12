'use client'

import { useEffect, useState } from 'react'
import { Upload, Loader2, FileText, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'

interface SourceFileStatus {
  file: string
  chunks: number
  lastUpdated: string
}

interface CorpusStatus {
  fileCount: number
  chunkCount: number
  lastUpdated: string | null
  sourceDir: string
  sourceDirExists: boolean
  sourceFiles: SourceFileStatus[]
}

interface UploadResult {
  ok: boolean
  archiveName?: string
  force?: boolean
  totalFiles?: number
  summary: Array<{
    file: string
    status: 'processed' | 'skipped' | 'failed' | 'pending'
    chunks?: number
    reason?: string
  }>
  deadlineHit?: boolean
  elapsedMs?: number
  error?: string
}

export default function MattesCorpusPage() {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [force, setForce] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadStatus() {
    setStatusLoading(true)
    try {
      const res = await fetch('/api/admin/mattes/backfill', { credentials: 'include', cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as CorpusStatus
        setStatus(data)
      }
    } catch (err) {
      console.error('[MattesCorpus] status fetch failed:', err)
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  async function handleUpload() {
    if (!file || uploading) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('archive', file)
      formData.append('force', force ? 'true' : 'false')
      const res = await fetch('/api/admin/mattes/upload-zip', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      const data = (await res.json()) as UploadResult
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`)
      } else {
        setResult(data)
        await loadStatus()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter">Mattes-Korpus</h1>
        <p className="mt-1 text-muted-foreground">
          Quellgrundlage für die Synthszr-Take-Stimme. Lade ein .zip des
          repo.md-Ordners hoch, um die Embeddings zu aktualisieren.
        </p>
      </div>

      {/* Status Snapshot */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Aktueller Stand</CardTitle>
              <CardDescription>
                Was steckt aktuell in <code className="text-xs">mattes_corpus_chunks</code>?
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadStatus} disabled={statusLoading}>
              {statusLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statusLoading && !status && (
            <p className="text-sm text-muted-foreground">Lade …</p>
          )}
          {status && (
            <>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-2xl font-bold">{status.fileCount}</div>
                  <div className="text-xs text-muted-foreground">Quelldateien</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{status.chunkCount}</div>
                  <div className="text-xs text-muted-foreground">Chunks (eingebettet)</div>
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {status.lastUpdated
                      ? new Date(status.lastUpdated).toLocaleString('de-DE', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">Letztes Update</div>
                </div>
              </div>

              {status.sourceFiles.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-mono uppercase tracking-wider">Datei</th>
                        <th className="text-right px-3 py-2 font-mono uppercase tracking-wider">Chunks</th>
                        <th className="text-right px-3 py-2 font-mono uppercase tracking-wider">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {status.sourceFiles.map((f) => (
                        <tr key={f.file}>
                          <td className="px-3 py-2 font-mono">{f.file}</td>
                          <td className="px-3 py-2 text-right">{f.chunks}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {new Date(f.lastUpdated).toLocaleDateString('de-DE')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {status.sourceFiles.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Noch keine Chunks. Lade unten ein .zip hoch.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Upload Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Neues Repo-Archiv hochladen</CardTitle>
          <CardDescription>
            ZIP-Datei mit allen .md-Files des Mattes-Repos (max. 30 MB).
            Dateien mit unveränderter sha werden übersprungen, sofern
            „Alles neu embedden" deaktiviert ist.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="zip-upload">Archiv (.zip)</Label>
            <input
              id="zip-upload"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null)
                setResult(null)
                setError(null)
              }}
              className="block w-full mt-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/70 file:cursor-pointer"
            />
            {file && (
              <p className="mt-1 text-xs text-muted-foreground">
                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          <div className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <Label htmlFor="force-toggle" className="text-sm font-medium">
                Alles neu embedden
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Standardmäßig werden Dateien mit unverändertem Inhalt
                (sha-match) übersprungen. Schalte um, um auch
                unveränderte Dateien neu zu prozessieren.
              </p>
            </div>
            <Switch id="force-toggle" checked={force} onCheckedChange={setForce} disabled={uploading} />
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button onClick={handleUpload} disabled={!file || uploading} className="gap-2">
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verarbeite …
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Hochladen und Embedden
                </>
              )}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert>
              <AlertDescription>
                <div className="mb-2 font-medium">
                  {result.archiveName} — {result.totalFiles} .md-Dateien
                  {result.deadlineHit && ' (Soft-Deadline erreicht; bitte nochmal hochladen)'}
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  Dauer: {((result.elapsedMs ?? 0) / 1000).toFixed(1)} s
                  {result.force ? ' · force: ja' : ''}
                </div>
                <div className="border rounded overflow-hidden mt-2">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-2 py-1 font-mono uppercase tracking-wider">Datei</th>
                        <th className="text-left px-2 py-1 font-mono uppercase tracking-wider">Status</th>
                        <th className="text-right px-2 py-1 font-mono uppercase tracking-wider">Chunks</th>
                        <th className="text-left px-2 py-1 font-mono uppercase tracking-wider">Anmerkung</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.summary.map((r, i) => (
                        <tr key={`${r.file}-${i}`}>
                          <td className="px-2 py-1 font-mono">{r.file}</td>
                          <td className="px-2 py-1">
                            <span
                              className={
                                r.status === 'processed'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : r.status === 'skipped'
                                    ? 'text-muted-foreground'
                                    : r.status === 'pending'
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-red-700 dark:text-red-400'
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right">{r.chunks ?? '—'}</td>
                          <td className="px-2 py-1 text-muted-foreground">{r.reason || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Wofür wird das genutzt?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Der Ghostwriter-Pipeline-Schritt <code className="text-xs">writeSection</code> ruft pro
            News-Item bis zu vier semantisch nächste Passagen aus deinem Korpus ab und legt sie als
            Mattes-Kontext-Block an den Section-Prompt an.
          </p>
          <p>
            Die gleichzeitig im <code className="text-xs">SECTION_SYSTEM_PROMPT</code> hinterlegten
            Vokabel- und Argumentationsmuster greifen ohnehin bei jedem Take. Dieser Korpus
            ergänzt sie mit konkreten Textstellen.
          </p>
          <p>
            Sha-basierte Inkrementell-Synchronisation: nur Dateien, deren Inhalt sich seit dem
            letzten Upload geändert hat, werden neu embedded. Optionaler Force-Schalter überschreibt das.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
