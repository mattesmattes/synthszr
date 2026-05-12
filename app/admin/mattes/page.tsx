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

interface AggregatedResult {
  archiveName: string
  status: 'success' | 'error'
  totalFiles?: number
  elapsedMs?: number
  deadlineHit?: boolean
  summary?: UploadResult['summary']
  error?: string
}

export default function MattesCorpusPage() {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [files, setFiles] = useState<File[]>([])
  const [force, setForce] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [currentlyUploading, setCurrentlyUploading] = useState<string | null>(null)
  const [results, setResults] = useState<AggregatedResult[]>([])
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
    if (files.length === 0 || uploading) return
    setUploading(true)
    setError(null)
    setResults([])
    const aggregated: AggregatedResult[] = []

    for (const file of files) {
      setCurrentlyUploading(file.name)
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
          aggregated.push({
            archiveName: file.name,
            status: 'error',
            error: data.error || `HTTP ${res.status}`,
          })
        } else {
          aggregated.push({
            archiveName: file.name,
            status: 'success',
            totalFiles: data.totalFiles,
            elapsedMs: data.elapsedMs,
            deadlineHit: data.deadlineHit,
            summary: data.summary,
          })
        }
      } catch (err) {
        aggregated.push({
          archiveName: file.name,
          status: 'error',
          error: err instanceof Error ? err.message : 'Unbekannter Fehler',
        })
      }
      setResults([...aggregated])
    }

    setCurrentlyUploading(null)
    setUploading(false)
    await loadStatus()
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
            <Label htmlFor="zip-upload">Archiv(e) (.zip)</Label>
            <input
              id="zip-upload"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              multiple
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []))
                setResults([])
                setError(null)
              }}
              className="block w-full mt-1 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-muted file:text-foreground hover:file:bg-muted/70 file:cursor-pointer"
            />
            {files.length > 0 && (
              <ul className="mt-2 text-xs text-muted-foreground space-y-0.5">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex justify-between gap-3">
                    <span className="font-mono truncate">{f.name}</span>
                    <span className="shrink-0">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                  </li>
                ))}
                <li className="border-t pt-1 mt-1 flex justify-between font-medium">
                  <span>Gesamt</span>
                  <span>
                    {files.length} Datei{files.length === 1 ? '' : 'en'} ·{' '}
                    {(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} MB
                  </span>
                </li>
              </ul>
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

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {uploading && currentlyUploading && (
                <>Verarbeite gerade: <span className="font-mono">{currentlyUploading}</span></>
              )}
              {uploading && results.length > 0 && (
                <span className="ml-2">({results.length}/{files.length} fertig)</span>
              )}
            </div>
            <Button onClick={handleUpload} disabled={files.length === 0 || uploading} className="gap-2">
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verarbeite …
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  {files.length > 1 ? `${files.length} Archive hochladen` : 'Hochladen und Embedden'}
                </>
              )}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {results.map((r, ri) => (
            <Alert key={`${r.archiveName}-${ri}`} variant={r.status === 'error' ? 'destructive' : undefined}>
              <AlertDescription>
                <div className="mb-2 font-medium flex items-center justify-between gap-2">
                  <span className="font-mono truncate">{r.archiveName}</span>
                  <span className="text-xs shrink-0">
                    {r.status === 'success' && r.totalFiles !== undefined ? `${r.totalFiles} Datei${r.totalFiles === 1 ? '' : 'en'}` : ''}
                    {r.status === 'success' && r.elapsedMs !== undefined && ` · ${(r.elapsedMs / 1000).toFixed(1)}s`}
                  </span>
                </div>
                {r.status === 'error' && (
                  <div className="text-sm">{r.error}</div>
                )}
                {r.status === 'success' && r.deadlineHit && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                    Soft-Deadline erreicht — bitte nochmal hochladen, um die Pending-Dateien zu erledigen.
                  </div>
                )}
                {r.status === 'success' && r.summary && (
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
                        {r.summary.map((s, si) => (
                          <tr key={`${s.file}-${si}`}>
                            <td className="px-2 py-1 font-mono">{s.file}</td>
                            <td className="px-2 py-1">
                              <span
                                className={
                                  s.status === 'processed'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : s.status === 'skipped'
                                      ? 'text-muted-foreground'
                                      : s.status === 'pending'
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-red-700 dark:text-red-400'
                                }
                              >
                                {s.status}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-right">{s.chunks ?? '—'}</td>
                            <td className="px-2 py-1 text-muted-foreground">{s.reason || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          ))}
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
