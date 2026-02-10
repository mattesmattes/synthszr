'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Play, Pause, Star, Pencil, Trash2, Upload, Loader2 } from 'lucide-react'

export interface AudioFile {
  id: string
  name: string
  type: 'intro' | 'outro'
  url: string
  file_size: number | null
  duration_sec: number | null
  is_active: boolean
  created_at: string
}

interface AudioFileManagerProps {
  type: 'intro' | 'outro'
  files: AudioFile[]
  onRefresh: () => void
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatGermanDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function AudioFileManager({ type, files, onRefresh }: AudioFileManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const [playingId, setPlayingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [mutating, setMutating] = useState<string | null>(null)

  const handlePlay = (file: AudioFile) => {
    if (playingId === file.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (audioRef.current) {
      audioRef.current.src = file.url
      audioRef.current.play()
      setPlayingId(file.id)
    }
  }

  const handleAudioEnded = () => {
    setPlayingId(null)
  }

  const handleActivate = async (id: string) => {
    setMutating(id)
    try {
      await fetch('/api/admin/audio-files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: true }),
      })
      onRefresh()
    } finally {
      setMutating(null)
    }
  }

  const handleStartRename = (file: AudioFile) => {
    setRenamingId(file.id)
    setRenameValue(file.name)
  }

  const handleConfirmRename = async (id: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null)
      return
    }
    setMutating(id)
    try {
      await fetch('/api/admin/audio-files', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: renameValue.trim() }),
      })
      onRefresh()
    } finally {
      setMutating(null)
      setRenamingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setMutating(id)
    try {
      await fetch(`/api/admin/audio-files?id=${id}`, { method: 'DELETE' })
      if (playingId === id) {
        audioRef.current?.pause()
        setPlayingId(null)
      }
      onRefresh()
    } finally {
      setMutating(null)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
    const nameWithoutExt = file.name.replace(/\.[^.]+$/, '')
    setPendingName(nameWithoutExt)
    e.target.value = ''
  }

  const handleUpload = async () => {
    if (!pendingFile || !pendingName.trim()) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', pendingFile)
      formData.append('name', pendingName.trim())
      formData.append('type', type)
      await fetch('/api/admin/audio-files', {
        method: 'POST',
        body: formData,
      })
      setPendingFile(null)
      setPendingName('')
      onRefresh()
    } finally {
      setUploading(false)
    }
  }

  const handleCancelUpload = () => {
    setPendingFile(null)
    setPendingName('')
  }

  return (
    <div className="space-y-2">
      <audio ref={audioRef} onEnded={handleAudioEnded} className="hidden" />

      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1.5 hover:bg-muted/50"
        >
          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => handlePlay(file)}
          >
            {playingId === file.id ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* Name */}
          <div className="flex-1 min-w-0">
            {renamingId === file.id ? (
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmRename(file.id)
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                onBlur={() => handleConfirmRename(file.id)}
                className="h-6 text-sm px-1.5"
                autoFocus
              />
            ) : (
              <span className="truncate block" title={`${file.name} (${formatFileSize(file.file_size)}, ${formatGermanDate(file.created_at)})`}>
                {file.name}
              </span>
            )}
          </div>

          {/* Active star */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => !file.is_active && handleActivate(file.id)}
            disabled={file.is_active || mutating === file.id}
            title={file.is_active ? 'Aktiv' : 'Als aktiv setzen'}
          >
            {mutating === file.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Star
                className={`h-3.5 w-3.5 ${file.is_active ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
              />
            )}
          </Button>

          {/* Rename */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => handleStartRename(file)}
            disabled={mutating === file.id}
            title="Umbenennen"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          {/* Delete */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => handleDelete(file.id)}
            disabled={file.is_active || mutating === file.id}
            title={file.is_active ? 'Aktive Datei kann nicht gelöscht werden' : 'Löschen'}
          >
            <Trash2 className={`h-3.5 w-3.5 ${file.is_active ? 'text-muted-foreground/40' : 'text-destructive/70'}`} />
          </Button>
        </div>
      ))}

      {files.length === 0 && (
        <p className="text-sm text-muted-foreground px-2 py-1">
          Keine {type === 'intro' ? 'Intro' : 'Outro'}-Dateien vorhanden.
        </p>
      )}

      {/* Upload section */}
      <div className="pt-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
          onChange={handleFileSelect}
          className="hidden"
        />

        {pendingFile ? (
          <div className="flex items-center gap-2">
            <Input
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleUpload()
                if (e.key === 'Escape') handleCancelUpload()
              }}
              placeholder="Dateiname"
              className="h-8 text-sm flex-1"
              disabled={uploading}
            />
            <Button
              size="sm"
              className="h-8 text-sm"
              onClick={handleUpload}
              disabled={uploading || !pendingName.trim()}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1.5" />
              )}
              Hochladen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-sm"
              onClick={handleCancelUpload}
              disabled={uploading}
            >
              Abbrechen
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            MP3 auswählen
          </Button>
        )}
      </div>
    </div>
  )
}
