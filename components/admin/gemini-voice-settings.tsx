'use client'

/**
 * Gemini-Besetzung im Aufnahme-Tab des Podcast Studios (seit 2026-11-16):
 * Modell, Stimmen für Emma (HOST) und den Synthesizer (GUEST) je Sprache und
 * eine Stimmprobe. Gespeichert wird über „Einstellungen speichern“ der Karte.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  GEMINI_LIBRARY_LANGUAGE,
  GEMINI_PREVIEW_TEXT,
  GEMINI_TTS_MODELS,
  GEMINI_TTS_PRICE_HINT,
  geminiVoiceGroups,
  type GeminiLibraryVoice,
  type GeminiTTSModel,
  type PodcastTTSLang,
} from '@/lib/tts/gemini-voices'
import { GEMINI_MODEL_LABELS } from '@/lib/tts/podcast-voices'
import { loadLibraryVoices, requestLineAudio } from '@/lib/tts/voice-lab-client'

export interface GeminiCast {
  model: GeminiTTSModel
  voices: Record<PodcastTTSLang, { host: string; guest: string }>
}

const LANGS: Array<{ id: PodcastTTSLang; name: string }> = [
  { id: 'de', name: 'Deutsch' },
  { id: 'en', name: 'Englisch' },
]

const SPEAKERS = [
  { id: 'host' as const, name: 'Emma (HOST)' },
  { id: 'guest' as const, name: 'Synthesizer (GUEST)' },
]

/** Stimmen der erweiterten Bibliothek (de-DE), einmal je Sitzung geladen. */
export function useGeminiLibraryVoices(languageCode: string = GEMINI_LIBRARY_LANGUAGE) {
  const [state, setState] = useState<{ voices: GeminiLibraryVoice[]; error: string | null; loading: boolean }>({ voices: [], error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    loadLibraryVoices(languageCode).then((r) => {
      if (!cancelled) setState({ voices: r.voices, error: r.error ?? null, loading: false })
    })
    return () => { cancelled = true }
  }, [languageCode])
  return state
}

/** Kurzzeile zum Stand der Bibliothek, damit ein Fehler sofort sichtbar ist. */
export function libraryStatusText(state: { voices: GeminiLibraryVoice[]; error: string | null; loading: boolean }): string {
  if (state.loading) return `Stimmbibliothek ${GEMINI_LIBRARY_LANGUAGE} wird geladen …`
  if (state.error) return `Stimmbibliothek ${GEMINI_LIBRARY_LANGUAGE} nicht erreichbar: ${state.error}`
  const female = state.voices.filter((v) => v.gender === 'female').length
  const male = state.voices.filter((v) => v.gender === 'male').length
  return state.voices.length === 0
    ? `Stimmbibliothek ${GEMINI_LIBRARY_LANGUAGE}: keine Stimmen gefunden`
    : `Stimmbibliothek ${GEMINI_LIBRARY_LANGUAGE}: ${state.voices.length} Stimmen (${female} weiblich, ${male} männlich)`
}

export function GeminiVoiceSelect({
  value,
  onChange,
  label,
  library = [],
  triggerClassName,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  library?: GeminiLibraryVoice[]
  triggerClassName?: string
}) {
  const groups = geminiVoiceGroups(library, [value])
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className={triggerClassName}><SelectValue /></SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectGroup key={g.label}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface Props {
  value: GeminiCast
  onChange: (next: GeminiCast) => void
  /** Gemini ist der Anbieter der Podcast-Jobs. */
  active: boolean
}

export function GeminiVoiceSettings({ value, onChange, active }: Props) {
  const library = useGeminiLibraryVoices()
  const [sampleLang, setSampleLang] = useState<PodcastTTSLang>('en')
  const [sampleSpeaker, setSampleSpeaker] = useState<'host' | 'guest'>('host')
  const [sampleStyle, setSampleStyle] = useState('')
  const [sampleText, setSampleText] = useState(GEMINI_PREVIEW_TEXT.en.host)
  const [sampleUrl, setSampleUrl] = useState<string | null>(null)
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Probetext folgt Sprache und Sprecher, solange er nicht von Hand geändert
  // ist; ein Sprachwechsel lädt immer den Probetext der neuen Sprache
  // (Betreiber 2026-11-16: deutsche Tests mit deutschem Text).
  const [textEdited, setTextEdited] = useState(false)
  useEffect(() => {
    if (!textEdited) setSampleText(GEMINI_PREVIEW_TEXT[sampleLang][sampleSpeaker])
  }, [sampleLang, sampleSpeaker, textEdited])

  useEffect(() => () => { if (sampleUrl) URL.revokeObjectURL(sampleUrl) }, [sampleUrl])

  function setVoice(lang: PodcastTTSLang, speaker: 'host' | 'guest', voice: string) {
    onChange({ ...value, voices: { ...value.voices, [lang]: { ...value.voices[lang], [speaker]: voice } } })
  }

  async function playSample() {
    setSampleBusy(true)
    setSampleError(null)
    try {
      const style = sampleStyle.trim()
      const audio = await requestLineAudio({
        provider: 'gemini',
        model: value.model,
        voice: value.voices[sampleLang][sampleSpeaker],
        text: style ? `[${style}] ${sampleText}` : sampleText,
      })
      setSampleUrl(audio.url)
      setTimeout(() => audioRef.current?.play().catch(() => {}), 0)
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : 'Stimmprobe fehlgeschlagen')
    } finally {
      setSampleBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Label className="text-base font-semibold">Gemini</Label>
          <p className="text-sm text-muted-foreground">{GEMINI_TTS_PRICE_HINT[value.model]}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={active ? 'default' : 'outline'}>{active ? 'aktiv' : 'nicht aktiv'}</Badge>
          <Select value={value.model} onValueChange={(m) => onChange({ ...value, model: m as GeminiTTSModel })}>
            <SelectTrigger className="w-60" aria-label="Gemini-Modell"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GEMINI_TTS_MODELS.map((m) => (
                <SelectItem key={m} value={m}>{GEMINI_MODEL_LABELS[m] ?? m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {LANGS.map((lang) => (
          <div key={lang.id} className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">{lang.name}</p>
            {SPEAKERS.map((s) => (
              <GeminiVoiceSelect
                key={s.id}
                label={`${s.name}, ${lang.name}`}
                value={value.voices[lang.id][s.id]}
                onChange={(v) => setVoice(lang.id, s.id, v)}
                library={library.voices}
              />
            ))}
          </div>
        ))}
      </div>

      <p className={library.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{libraryStatusText(library)}</p>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Stimmprobe</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={sampleLang} onValueChange={(v) => { setSampleLang(v as PodcastTTSLang); setTextEdited(false) }}>
            <SelectTrigger aria-label="Sprache der Probe"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGS.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sampleSpeaker} onValueChange={(v) => setSampleSpeaker(v as 'host' | 'guest')}>
            <SelectTrigger aria-label="Sprecher der Probe"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SPEAKERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}: {value.voices[sampleLang][s.id]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={sampleStyle}
            onChange={(e) => setSampleStyle(e.target.value)}
            placeholder="Anweisung, z. B. dry, quick"
            aria-label="Sprechanweisung der Probe"
          />
        </div>
        <Textarea
          value={sampleText}
          onChange={(e) => { setSampleText(e.target.value); setTextEdited(true) }}
          className="text-sm h-20"
          aria-label="Probetext"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={playSample} disabled={sampleBusy || !sampleText.trim()}>
            {sampleBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Probe hören
          </Button>
          {textEdited && (
            <Button size="sm" variant="ghost" onClick={() => setTextEdited(false)}>Probetext zurücksetzen</Button>
          )}
          {sampleError && <span className="text-sm text-destructive">{sampleError}</span>}
        </div>
        {sampleUrl && <audio ref={audioRef} src={sampleUrl} controls className="w-full h-10" />}
        <p className="text-xs text-muted-foreground">
          Gemini liest den Text wörtlich und erkennt die Sprache selbst. Die Anweisung am Zeilenanfang geht als
          <code className="mx-1 rounded bg-muted px-1">style</code>mit, Pausen und Lacher mitten im Satz werden zu
          Geminis Inline-Tags. Ganze Folgen vergleichst du im Tab „Stimmtest“.
        </p>
      </div>
    </div>
  )
}
