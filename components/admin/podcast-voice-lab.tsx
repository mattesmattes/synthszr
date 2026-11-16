'use client'

/**
 * Tab „Stimmtest“ im Podcast Studio (Betreiber 2026-11-16): echte Skriptzeilen
 * mit zwei Modell-Kits (Anbieter, Modell, Stimme für Emma und Synthesizer)
 * nebeneinander vertonen und vergleichen. Jede Zeile geht über
 * POST /api/admin/podcast-voice-lab durch dieselbe Umsetzung wie der
 * Audio-Job (lib/tts/line-delivery.ts, lib/tts/render-line.ts); die Tabelle
 * zeigt, wie die Sprechanweisung beim Modell ankommt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical, Loader2, Play, RefreshCw, Save, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { parseScriptText, type PodcastLine } from '@/lib/tts/elevenlabs-tts'
import {
  DEFAULT_GEMINI_TTS_MODEL,
  GEMINI_TTS_MODELS,
  GEMINI_TTS_PRICE_HINT,
  isGeminiTTSModel,
  type GeminiLibraryVoice,
  type GeminiTTSModel,
  type PodcastTTSLang,
  type PodcastTTSProvider,
} from '@/lib/tts/gemini-voices'
import { GeminiVoiceSelect, libraryStatusText, useGeminiLibraryVoices } from '@/components/admin/gemini-voice-settings'
import { describeDelivery, prepareLineForTTS, spokenText } from '@/lib/tts/line-delivery'
import { GEMINI_MODEL_LABELS, OPENAI_MODEL_LABELS, OPENAI_PODCAST_VOICES, OPENAI_TTS_MODELS } from '@/lib/tts/podcast-voices'
import { requestLineAudio, type LineAudio } from '@/lib/tts/voice-lab-client'
import { VOICE_LAB_SAMPLE_SCRIPTS } from '@/lib/tts/voice-lab-samples'
import { detectLanguage } from '@/lib/agents/language'

/** Höchstens so viele Zeilen je Durchgang (Kosten, Wartezeit). */
export const MAX_SELECTED_LINES = 12
const DEFAULT_SELECTION = 6
/** Parallele Aufrufe je Kit; Ratenlimits der Gemini-3.8-Modelle sind nicht dokumentiert. */
const CONCURRENCY = 2

export interface VoiceKit {
  provider: PodcastTTSProvider
  model: string
  host: string
  guest: string
}

export interface VoiceLabSettings {
  provider: PodcastTTSProvider
  openaiModel: string
  openaiHost: string
  openaiGuest: string
  geminiModel: GeminiTTSModel
  geminiVoices: Record<PodcastTTSLang, { host: string; guest: string }>
}

interface ScriptMeta {
  postId: string
  locale: string
  /** Sprache des Skripts (erkannt), nicht die Sprachzeile in post_podcasts. */
  lang?: PodcastTTSLang
  title: string | null
  createdAt: string
  durationSeconds: number | null
  lines: number
}

/** Sprache eines Skripts aus dem gesprochenen Text (Stoppwort-Heuristik). */
export function scriptLangOf(script: string): PodcastTTSLang | null {
  const spoken = script
    .split('\n')
    .filter((l) => /^(HOST|GUEST)/i.test(l.trim()))
    .map((l) => l.replace(/^(HOST|GUEST)[^:]*:\s*/i, '').replace(/\[[^\]]*\]/g, ' '))
    .join(' ')
  return detectLanguage(spoken)
}

const SAMPLE_SOURCE: Record<PodcastTTSLang, string> = { de: 'sample:de', en: 'sample:en' }

type LineResult = { status: 'pending' } | ({ status: 'done' } & LineAudio) | { status: 'error'; error: string }

interface Preset {
  id: string
  label: string
  kit: VoiceKit
}

export function buildPresets(settings: VoiceLabSettings, lang: PodcastTTSLang): Preset[] {
  const gemini = settings.geminiVoices[lang]
  const live: VoiceKit = settings.provider === 'gemini'
    ? { provider: 'gemini', model: settings.geminiModel, host: gemini.host, guest: gemini.guest }
    : { provider: 'openai', model: settings.openaiModel, host: settings.openaiHost, guest: settings.openaiGuest }
  return [
    { id: 'live', label: `Live-Besetzung (${kitLabel(live)})`, kit: live },
    { id: 'gemini-flash', label: 'Gemini 3.8 Flash TTS', kit: { provider: 'gemini', model: 'gemini-3.8-flash-tts', host: gemini.host, guest: gemini.guest } },
    { id: 'gemini-lite', label: 'Gemini 3.8 Flash Lite TTS', kit: { provider: 'gemini', model: 'gemini-3.8-flash-lite-tts', host: gemini.host, guest: gemini.guest } },
    { id: 'openai-mini', label: 'OpenAI gpt-4o-mini-tts', kit: { provider: 'openai', model: 'gpt-4o-mini-tts', host: settings.openaiHost, guest: settings.openaiGuest } },
    { id: 'openai-hd', label: 'OpenAI tts-1-hd', kit: { provider: 'openai', model: 'tts-1-hd', host: settings.openaiHost, guest: settings.openaiGuest } },
  ]
}

function sameKit(a: VoiceKit, b: VoiceKit): boolean {
  return a.provider === b.provider && a.model === b.model && a.host === b.host && a.guest === b.guest
}

export function kitLabel(kit: VoiceKit): string {
  const model = kit.provider === 'gemini' ? (GEMINI_MODEL_LABELS[kit.model] ?? kit.model) : kit.model
  return `${model} · ${kit.host} / ${kit.guest}`
}

/** Cache-Schlüssel: was sich am Ergebnis ändert, gehört hinein. */
export function resultKey(kit: VoiceKit, line: PodcastLine, withDirection: boolean): string {
  const voice = line.speaker === 'HOST' ? kit.host : kit.guest
  return [kit.provider, kit.model, voice, withDirection ? 'dir' : 'plain', line.text].join('|')
}

/** Die längsten Zeilen zuerst: Monologe sind für jede Stimme die härteste Probe. */
export function longestLines(lines: PodcastLine[], count: number): number[] {
  return lines
    .map((line, index) => ({ index, words: spokenText(line.text.replace(/\[[^\]]*\]/g, ' ')).split(' ').filter(Boolean).length }))
    .sort((a, b) => b.words - a.words)
    .slice(0, count)
    .map((x) => x.index)
    .sort((a, b) => a - b)
}

function range(start: number, count: number, max: number): number[] {
  const out: number[] = []
  for (let i = start; i < Math.min(start + count, max); i++) out.push(i)
  return out
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
}

const LANG_NAMES: Record<PodcastTTSLang, string> = { de: 'Deutsch', en: 'Englisch' }

function KitEditor({
  name,
  kit,
  onChange,
  presets,
  lang,
  library,
}: {
  name: string
  kit: VoiceKit
  onChange: (kit: VoiceKit) => void
  presets: Preset[]
  lang: PodcastTTSLang
  library: GeminiLibraryVoice[]
}) {
  const voices = OPENAI_PODCAST_VOICES.map((v) => ({ id: v.id, label: `${v.name} – ${v.description}` }))
  const models = kit.provider === 'gemini'
    ? GEMINI_TTS_MODELS.map((m) => ({ id: m as string, label: GEMINI_MODEL_LABELS[m] ?? m }))
    : OPENAI_TTS_MODELS.map((m) => ({ id: m as string, label: OPENAI_MODEL_LABELS[m] }))

  function switchProvider(provider: PodcastTTSProvider) {
    if (provider === kit.provider) return
    const preset = presets.find((p) => p.kit.provider === provider && p.id !== 'live')
    if (preset) onChange({ ...preset.kit })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Kit {name}</p>
        <Select value="" onValueChange={(id) => { const p = presets.find((x) => x.id === id); if (p) onChange({ ...p.kit }) }}>
          <SelectTrigger className="h-8 w-48 text-xs" aria-label={`Vorlage für Kit ${name}`}><SelectValue placeholder="Vorlage wählen" /></SelectTrigger>
          <SelectContent>
            {presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Anbieter</Label>
          <Select value={kit.provider} onValueChange={(v) => switchProvider(v as PodcastTTSProvider)}>
            <SelectTrigger aria-label={`Anbieter Kit ${name}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Modell</Label>
          <Select value={kit.model} onValueChange={(model) => onChange({ ...kit, model })}>
            <SelectTrigger aria-label={`Modell Kit ${name}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {models.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {kit.provider === 'gemini' ? (
          <>
            <GeminiVoiceSelect label={`Emma (HOST), Kit ${name}`} value={kit.host} onChange={(host) => onChange({ ...kit, host })} library={library} />
            <GeminiVoiceSelect label={`Synthesizer (GUEST), Kit ${name}`} value={kit.guest} onChange={(guest) => onChange({ ...kit, guest })} library={library} />
          </>
        ) : (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Emma (HOST)</Label>
              <Select value={kit.host} onValueChange={(host) => onChange({ ...kit, host })}>
                <SelectTrigger aria-label={`Emma Kit ${name}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {voices.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Synthesizer (GUEST)</Label>
              <Select value={kit.guest} onValueChange={(guest) => onChange({ ...kit, guest })}>
                <SelectTrigger aria-label={`Synthesizer Kit ${name}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {voices.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {kit.provider === 'gemini'
          ? `${GEMINI_TTS_PRICE_HINT[isGeminiTTSModel(kit.model) ? kit.model : DEFAULT_GEMINI_TTS_MODEL]}. Stimmen für ${LANG_NAMES[lang]} aus den Aufnahme-Einstellungen.`
          : kit.model === 'gpt-4o-mini-tts'
            ? 'Sprechanweisung geht als instructions mit.'
            : 'tts-1 / tts-1-hd verstehen keine Sprechanweisung; sie wird entfernt.'}
      </p>
    </div>
  )
}

interface Props {
  /** Skript aus dem Episode-Tab. */
  currentScript: string
  settings: VoiceLabSettings
  /** Gemini-Besetzung eines Kits für eine Sprache übernehmen (speichert die Einstellungen). */
  onAdoptGemini?: (lang: PodcastTTSLang, model: GeminiTTSModel, host: string, guest: string) => Promise<void>
}

export function PodcastVoiceLab({ currentScript, settings, onAdoptGemini }: Props) {
  const library = useGeminiLibraryVoices()
  const [scripts, setScripts] = useState<ScriptMeta[]>([])
  const [scriptsError, setScriptsError] = useState<string | null>(null)
  const [source, setSource] = useState<string>(currentScript.trim() ? 'current' : '')
  const [scriptText, setScriptText] = useState(currentScript)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [lang, setLang] = useState<PodcastTTSLang>(() => (currentScript.trim() ? scriptLangOf(currentScript) ?? 'en' : 'en'))
  const [selected, setSelected] = useState<number[]>(() => range(0, DEFAULT_SELECTION, Number.MAX_SAFE_INTEGER))
  const [withDirection, setWithDirection] = useState(true)
  const presets = useMemo(() => buildPresets(settings, lang), [settings, lang])
  const [kitA, setKitA] = useState<VoiceKit>(() => presets[0].kit)
  const [kitB, setKitB] = useState<VoiceKit>(() => (presets[0].kit.provider === 'gemini' ? presets[4].kit : presets[1].kit))
  const [results, setResults] = useState<Record<string, LineResult>>({})
  const [busy, setBusy] = useState<{ A: boolean; B: boolean }>({ A: false, B: false })
  const [playing, setPlaying] = useState<string | null>(null)
  const [adoptState, setAdoptState] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<string[]>([])
  const urlsRef = useRef<string[]>([])

  // Sprache oder Einstellungen gewechselt: Kits, die noch einer Vorlage
  // entsprechen, ziehen auf dieselbe Vorlage der neuen Besetzung um.
  const prevPresetsRef = useRef(presets)
  useEffect(() => {
    const prev = prevPresetsRef.current
    prevPresetsRef.current = presets
    if (prev === presets) return
    const remap = (kit: VoiceKit) => {
      const match = prev.find((p) => sameKit(p.kit, kit))
      return match ? (presets.find((p) => p.id === match.id)?.kit ?? kit) : kit
    }
    setKitA(remap)
    setKitB(remap)
  }, [presets])

  const lines = useMemo(() => parseScriptText(scriptText), [scriptText])
  const selectedLines = useMemo(() => selected.filter((i) => i < lines.length), [selected, lines.length])

  // Folgen mit Skript laden (einmal beim Öffnen des Tabs).
  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/podcast-voice-lab', { credentials: 'include' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok) throw new Error(data.error || 'Folgen konnten nicht geladen werden')
        setScripts(data.scripts ?? [])
        if (!currentScript.trim() && data.scripts?.[0]) setSource(`${data.scripts[0].postId}:${data.scripts[0].locale}`)
      })
      .catch((err) => { if (!cancelled) setScriptsError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
    // currentScript nur für die Startauswahl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Skript der gewählten Quelle laden.
  useEffect(() => {
    if (source === 'current') {
      setScriptText(currentScript)
      const detected = scriptLangOf(currentScript)
      if (detected) setLang(detected)
      return
    }
    if (source === SAMPLE_SOURCE.de || source === SAMPLE_SOURCE.en) {
      const sampleLang: PodcastTTSLang = source === SAMPLE_SOURCE.de ? 'de' : 'en'
      setScriptText(VOICE_LAB_SAMPLE_SCRIPTS[sampleLang])
      setLang(sampleLang)
      setSelected(range(0, DEFAULT_SELECTION, Number.MAX_SAFE_INTEGER))
      return
    }
    if (!source) return
    const [postId, locale] = source.split(':')
    let cancelled = false
    setScriptLoading(true)
    fetch(`/api/admin/podcast-voice-lab?postId=${encodeURIComponent(postId)}&locale=${encodeURIComponent(locale)}`, { credentials: 'include' })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok) throw new Error(data.error || 'Skript konnte nicht geladen werden')
        setScriptText(data.script)
        setLang(scriptLangOf(data.script) ?? (locale === 'de' ? 'de' : 'en'))
        setSelected(range(0, DEFAULT_SELECTION, Number.MAX_SAFE_INTEGER))
      })
      .catch((err) => { if (!cancelled) setScriptsError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { if (!cancelled) setScriptLoading(false) })
    return () => { cancelled = true }
  }, [source, currentScript])

  // Sprache des Tests: Deutsch braucht deutschen Text. Ist das Skript nicht
  // deutsch, kommt das deutsche Beispielskript; zurück auf Englisch die
  // jüngste Folge (alle Folgen sind englisch) oder das englische Beispiel.
  const scriptLang = useMemo(() => scriptLangOf(scriptText), [scriptText])
  function changeLang(next: PodcastTTSLang) {
    setLang(next)
    if (next === 'de' && scriptLang !== 'de') setSource(SAMPLE_SOURCE.de)
    if (next === 'en' && scriptLang === 'de') {
      const episode = scripts.find((s) => s.lang !== 'de')
      setSource(episode ? `${episode.postId}:${episode.locale}` : SAMPLE_SOURCE.en)
    }
  }

  // Objekt-URLs beim Verlassen freigeben.
  useEffect(() => () => {
    audioRef.current?.pause()
    for (const url of urlsRef.current) URL.revokeObjectURL(url)
  }, [])

  const stop = useCallback(() => {
    queueRef.current = []
    audioRef.current?.pause()
    setPlaying(null)
  }, [])

  const playKeys = useCallback((keys: string[]) => {
    const urls = keys.map((k) => results[k]).filter((r): r is { status: 'done' } & LineAudio => r?.status === 'done')
    if (urls.length === 0) return
    audioRef.current?.pause()
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    const playable = keys.filter((k) => results[k]?.status === 'done')
    queueRef.current = playable.slice(1)
    const playOne = (key: string) => {
      const r = results[key]
      if (r?.status !== 'done') return
      setPlaying(key)
      audio.src = r.url
      audio.play().catch(() => setPlaying(null))
    }
    audio.onended = () => {
      const next = queueRef.current.shift()
      if (next) playOne(next)
      else setPlaying(null)
    }
    playOne(playable[0])
  }, [results])

  async function renderKit(which: 'A' | 'B') {
    const kit = which === 'A' ? kitA : kitB
    const todo = selectedLines
      .map((index) => ({ index, line: lines[index], key: resultKey(kit, lines[index], withDirection) }))
      .filter(({ key }) => results[key]?.status !== 'done' && results[key]?.status !== 'pending')
    if (todo.length === 0) return
    setBusy((b) => ({ ...b, [which]: true }))
    setResults((r) => Object.fromEntries([...Object.entries(r), ...todo.map(({ key }) => [key, { status: 'pending' } as LineResult])]))
    let next = 0
    const worker = async () => {
      while (next < todo.length) {
        const { line, key } = todo[next++]
        try {
          const audio = await requestLineAudio({
            provider: kit.provider,
            model: kit.model,
            voice: line.speaker === 'HOST' ? kit.host : kit.guest,
            text: line.text,
            withDirection,
          })
          urlsRef.current.push(audio.url)
          setResults((r) => ({ ...r, [key]: { status: 'done', ...audio } }))
        } catch (err) {
          setResults((r) => ({ ...r, [key]: { status: 'error', error: err instanceof Error ? err.message : String(err) } }))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))
    setBusy((b) => ({ ...b, [which]: false }))
  }

  function toggleLine(index: number, checked: boolean) {
    setSelected((prev) => {
      if (!checked) return prev.filter((i) => i !== index)
      if (prev.includes(index) || prev.length >= MAX_SELECTED_LINES) return prev
      return [...prev, index].sort((a, b) => a - b)
    })
  }

  async function adopt(kit: VoiceKit) {
    if (!onAdoptGemini || kit.provider !== 'gemini' || !isGeminiTTSModel(kit.model)) return
    setAdoptState('saving')
    try {
      await onAdoptGemini(lang, kit.model, kit.host, kit.guest)
      setAdoptState(`Gemini-Besetzung für ${LANG_NAMES[lang]} gespeichert: ${kitLabel(kit)}`)
    } catch (err) {
      setAdoptState(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    }
  }

  const kits: Array<{ id: 'A' | 'B'; kit: VoiceKit; set: (k: VoiceKit) => void }> = [
    { id: 'A', kit: kitA, set: setKitA },
    { id: 'B', kit: kitB, set: setKitB },
  ]
  const firstSelected = selectedLines[0] ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5" />
          Stimmtest
        </CardTitle>
        <CardDescription>
          Echte Skriptzeilen mit zwei Modell-Kits vertonen und vergleichen. Jede Zeile läuft durch dieselbe Umsetzung wie
          der Audio-Job; nichts wird gespeichert. Jede vertonte Zeile kostet einen Bruchteil eines Cents, ein langer
          Monolog gut einen Cent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Skript und Sprache */}
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Skript</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger aria-label="Skript"><SelectValue placeholder={scripts.length ? 'Folge wählen' : 'Lade Folgen …'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SAMPLE_SOURCE.de}>Beispielskript Deutsch ({parseScriptText(VOICE_LAB_SAMPLE_SCRIPTS.de).length} Zeilen)</SelectItem>
                <SelectItem value={SAMPLE_SOURCE.en}>Beispielskript Englisch ({parseScriptText(VOICE_LAB_SAMPLE_SCRIPTS.en).length} Zeilen)</SelectItem>
                {currentScript.trim() && <SelectItem value="current">Aktuelles Skript aus dem Episode-Tab</SelectItem>}
                {scripts.map((s) => (
                  <SelectItem key={`${s.postId}:${s.locale}`} value={`${s.postId}:${s.locale}`}>
                    {formatDate(s.createdAt)} · {s.title ?? 'ohne Titel'} ({s.lines} Zeilen, {s.lang === 'de' ? 'deutsch' : 'englisch'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sprache des Tests</Label>
            <Select value={lang} onValueChange={(v) => changeLang(v as PodcastTTSLang)}>
              <SelectTrigger className="w-36" aria-label="Sprache des Tests"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">Englisch</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Switch id="voice-lab-direction" checked={withDirection} onCheckedChange={setWithDirection} />
            <Label htmlFor="voice-lab-direction" className="text-sm">Sprechanweisung mitsenden</Label>
          </div>
        </div>
        {scriptsError && <p className="text-sm text-destructive">{scriptsError}</p>}
        {lang === 'de' && scriptLang === 'en' && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-sm">
            <span>Das gewählte Skript ist englisch. Für einen deutschen Test braucht es deutschen Text.</span>
            <Button size="sm" variant="outline" onClick={() => setSource(SAMPLE_SOURCE.de)}>Deutsches Beispielskript laden</Button>
          </div>
        )}

        {/* Kits */}
        <div className="grid gap-4 md:grid-cols-2">
          {kits.map(({ id, kit, set }) => (
            <div key={id} className="space-y-2">
              <KitEditor name={id} kit={kit} onChange={set} presets={presets} lang={lang} library={library.voices} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => renderKit(id)} disabled={busy[id] || selectedLines.length === 0}>
                  {busy[id] ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Zeilen vertonen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => playKeys(selectedLines.map((i) => resultKey(kit, lines[i], withDirection)))}
                  disabled={!selectedLines.some((i) => results[resultKey(kit, lines[i], withDirection)]?.status === 'done')}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Alle abspielen
                </Button>
                {kit.provider === 'gemini' && onAdoptGemini && (
                  <Button size="sm" variant="ghost" onClick={() => adopt(kit)} disabled={adoptState === 'saving'}>
                    <Save className="mr-2 h-4 w-4" />
                    Als Gemini-Besetzung ({LANG_NAMES[lang]}) speichern
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className={library.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {libraryStatusText(library)}. Bibliotheksstimmen sprechen muttersprachlich Deutsch; Google dokumentiert nicht, wie sie im
          Aufruf stehen. Die erste vertonte Zeile zeigt, ob es klappt; ein Fehler steht dann in der Zeile.
        </p>
        {adoptState && adoptState !== 'saving' && <p className="text-sm text-muted-foreground">{adoptState}</p>}
        {playing && (
          <Button size="sm" variant="outline" onClick={stop}>
            <Square className="mr-2 h-4 w-4" />
            Wiedergabe stoppen
          </Button>
        )}

        {/* Auswahl */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {selectedLines.length} von {lines.length} Zeilen gewählt (höchstens {MAX_SELECTED_LINES})
          </span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(range(0, DEFAULT_SELECTION, lines.length))}>Erste {DEFAULT_SELECTION}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(range(firstSelected + DEFAULT_SELECTION, DEFAULT_SELECTION, lines.length))} disabled={firstSelected + DEFAULT_SELECTION >= lines.length}>Nächste {DEFAULT_SELECTION}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(longestLines(lines, 4))} disabled={lines.length === 0}>Längste Monologe</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Auswahl leeren</Button>
        </div>

        {/* Zeilen mit A/B */}
        {scriptLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Lade Skript …</div>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Kein Skript mit HOST-/GUEST-Zeilen gewählt.</p>
        ) : (
          <div className="max-h-[640px] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                <tr>
                  <th className="w-8 p-2" />
                  <th className="p-2">Zeile</th>
                  <th className="w-56 p-2">Kit A</th>
                  <th className="w-56 p-2">Kit B</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const isSelected = selected.includes(index)
                  const direction = prepareLineForTTS({ provider: 'gemini', model: DEFAULT_GEMINI_TTS_MODEL, text: line.text }).direction
                  const display = direction ? line.text.replace(/^\s*\[[^\]]*\]\s*/, '') : line.text
                  return (
                    <tr key={index} className={isSelected ? 'border-t bg-primary/5' : 'border-t'}>
                      <td className="p-2 align-top">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(c) => toggleLine(index, c === true)}
                          aria-label={`Zeile ${index + 1} auswählen`}
                        />
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">{index + 1}</span>
                          <Badge variant="outline">{line.speaker === 'HOST' ? 'Emma' : 'Synthesizer'}</Badge>
                          {line.overlapping && <Badge variant="secondary">overlapping</Badge>}
                          {direction && <Badge variant="secondary">[{direction}]</Badge>}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">{display}</p>
                      </td>
                      {kits.map(({ id, kit }) => {
                        if (!isSelected) return <td key={id} className="p-2 align-top text-xs text-muted-foreground">–</td>
                        const key = resultKey(kit, line, withDirection)
                        const r = results[key]
                        const delivery = prepareLineForTTS({ provider: kit.provider, model: kit.model, text: line.text, withDirection })
                        return (
                          <td key={id} className="p-2 align-top text-xs">
                            <div className="flex items-center gap-2">
                              <Button
                                size="icon"
                                variant={playing === key ? 'default' : 'outline'}
                                className="h-7 w-7"
                                onClick={() => (playing === key ? stop() : playKeys([key]))}
                                disabled={r?.status !== 'done'}
                                aria-label={`Kit ${id}, Zeile ${index + 1} abspielen`}
                              >
                                {r?.status === 'pending' ? <Loader2 className="h-3 w-3 animate-spin" /> : playing === key ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              </Button>
                              {r?.status === 'done' && <span>{r.durationSec.toFixed(1)} s · {(r.ms / 1000).toFixed(1)} s Rechenzeit</span>}
                              {!r && <span className="text-muted-foreground">noch nicht vertont</span>}
                            </div>
                            <p className="mt-1 text-muted-foreground">{describeDelivery(delivery)}</p>
                            {r?.status === 'error' && <p className="mt-1 text-destructive">{r.error}</p>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
