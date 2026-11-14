/**
 * Trockenlauf für die Podcast-Skript-Kette (Tonalität v2 mit Tagesregie und
 * Texturdurchgang, 2026-11-14). Baut dieselben Prompts wie
 * /api/podcast/generate-script, aus Dateien statt aus der Datenbank, Stufe für
 * Stufe; mit --call und ANTHROPIC_API_KEY ruft jede Stufe auch das Modell.
 *
 *   # 1. Regie: Sampler-Koordinaten + Regisseur-Prompt (oder --call: Regisseur ausführen)
 *   npx tsx scripts/podcast-style-dryrun.ts director --post post.txt --date 2026-11-14T08:15:11Z --history history.json --out dir [--call]
 *   # 2. Skript: System- und User-Prompt (Regie aus dir/coords.json, Ausgestaltung aus dir/regie-fill.json)
 *   npx tsx scripts/podcast-style-dryrun.ts script --post post.txt --state state.json --date … --out dir [--recent a.txt,b.txt] [--minutes 15] [--call]
 *   # 3. Textur: Prompts für den zweiten Durchgang über dir/script.txt
 *   npx tsx scripts/podcast-style-dryrun.ts texture --post post.txt --out dir [--recent …] [--call]
 *   # 4. Prüfung: dir/textured.txt gegen dir/script.txt → dir/final.txt
 *   npx tsx scripts/podcast-style-dryrun.ts validate --out dir
 *   # 5. Historie fortschreiben
 *   npx tsx scripts/podcast-style-dryrun.ts record --out dir --history history.json
 *
 * post.txt: erste Zeile „Title: …", danach der Klartext des Posts.
 * state.json: eine Zeile aus podcast_personality_state (locale en).
 *
 * Abweichungen von der Route: keine Wochen-Modi aus der DB (eingebaute
 * Einstiege/Schlüsse), keine „zuletzt gelaufen"-Liste, kein Episoden-
 * Gedächtnis, kein Smalltalk, kein Intermezzo. Stimmen, Dialogregeln,
 * Folgenaufbau, Tagesregie, Fingerabdruck, Persönlichkeits-Brief und
 * Texturdurchgang sind identisch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SCRIPT_PROMPT_EN } from '@/lib/podcast/script-templates'
import { resolveDialogueRules } from '@/lib/podcast/dialogue-style'
import { EPISODE_SHAPE_EN, VOICE_STYLE_EN } from '@/lib/podcast/voice-style'
import { episodeGreetingSuffix, milestonePromptSection } from '@/lib/podcast/episode-number'
import { synthszrIssueNumber } from '@/lib/i18n/config'
import { pickCloser, pickOpener } from '@/lib/podcast/openers'
import { buildPersonalityBrief, type PersonalityState } from '@/lib/podcast/personality'
import { computeWornOut, wornSection } from '@/lib/podcast/fingerprint'
import { sampleRegie, type RegieCoordinates, type RegieHistoryEntry } from '@/lib/podcast/regie/sampler'
import { buildDirectorPrompt, parseRegieFill, runDirector, summarizeCoordinates, type RegieFill } from '@/lib/podcast/regie/director'
import { coarsenessInstruction, renderRegieSection, textureDeviceNotes } from '@/lib/podcast/regie/render'
import { withEntry } from '@/lib/podcast/regie/history'
import { articleEchoes, buildTexturePrompt, quotesFromMoments, splitMomentsSection, stripPreamble, validateTexture } from '@/lib/podcast/texture-pass'

const stage = process.argv[2]
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const out = arg('out') ?? './podcast-dryrun'
mkdirSync(out, { recursive: true })
const call = process.argv.includes('--call')

function readPost() {
  const file = arg('post')
  if (!file) throw new Error('--post fehlt')
  const [first, ...rest] = readFileSync(file, 'utf-8').split('\n')
  return { title: first.replace(/^Title:\s*/, '').trim(), content: rest.join('\n').trim() }
}
const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) as T : fallback)
const recentScripts = () => (arg('recent') ? arg('recent')!.split(',').filter(Boolean).map((f) => readFileSync(f, 'utf-8')) : [])
const coordsFile = join(out, 'coords.json')

/** regie-fill.json: Rohausgabe des Regisseurs (snake_case, wird geprüft) oder schon geprüfte RegieFill. */
function readFill(content: string, coords: RegieCoordinates): RegieFill | null {
  const raw = readJson<unknown>(join(out, 'regie-fill.json'), null)
  if (!raw) return null
  return (raw as { devicePlans?: unknown }).devicePlans ? (raw as RegieFill) : parseRegieFill(raw, { content, coords })
}

async function main() {
  if (stage === 'director') {
    const post = readPost()
    const date = new Date(arg('date') ?? Date.now()).toISOString().slice(0, 10)
    const history = readJson<RegieHistoryEntry[]>(arg('history') ?? '', [])
    const coords = sampleRegie(history, { date, postId: arg('post-id') ?? date })
    writeFileSync(coordsFile, JSON.stringify(coords, null, 1))
    writeFileSync(join(out, 'director-prompt.txt'), buildDirectorPrompt({ ...post, coords }))
    console.log('Regie:', JSON.stringify(summarizeCoordinates(coords)))
    if (call) {
      const fill = await runDirector({ ...post, coords })
      writeFileSync(join(out, 'regie-fill.json'), JSON.stringify(fill, null, 1))
      console.log('Regisseur:', fill ? 'ausgestaltet' : 'ohne Ergebnis')
    }
    return
  }

  if (stage === 'script') {
    const post = readPost()
    const state = readJson<PersonalityState | null>(arg('state') ?? '', null)
    if (!state) throw new Error('--state fehlt')
    const coords = readJson<RegieCoordinates | null>(coordsFile, null)
    if (!coords) throw new Error(`${coordsFile} fehlt (erst Stufe director)`)
    const fill = readFill(post.content, coords)
    const postDate = new Date(arg('date') ?? Date.now())
    const minutes = Number(arg('minutes') ?? 15)
    const wordCount = Math.round(minutes * 150)
    const maxWordCount = Math.round(wordCount * 1.25)
    const perTopicWords = Math.max(80, Math.round(wordCount / 7))
    const weekday = postDate.toLocaleDateString('en-US', { weekday: 'long' })
    const date = postDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const episode = synthszrIssueNumber(postDate)

    let user = DEFAULT_SCRIPT_PROMPT_EN
      .replaceAll('{duration}', String(minutes))
      .replaceAll('{wordCount}', String(wordCount))
      .replaceAll('{maxWordCount}', String(maxWordCount))
      .replaceAll('{perTopicWords}', String(perTopicWords))
      .replaceAll('{title}', post.title)
      .replaceAll('{content}', () => post.content)
      .replaceAll('{weekday}', weekday)
      .replaceAll('{date}', date)
      .replaceAll('{episodeSuffix}', episodeGreetingSuffix(episode, 'en'))
      .replaceAll('{dialogueRules}', () => resolveDialogueRules('en', null))
      .replaceAll('{voiceStyle}', () => VOICE_STYLE_EN)
      .replaceAll('{episodeShape}', () => EPISODE_SHAPE_EN)
    const dayOfYear = Math.floor((postDate.getTime() - new Date(postDate.getFullYear(), 0, 0).getTime()) / 86_400_000)
    const opener = pickOpener(dayOfYear)
    const closer = pickCloser(dayOfYear)
    user += `\n\n**OPENING OF THIS EPISODE (mandatory):**\n${opener.instruction}\nThe recognisable greeting follows AFTER that — within roughly 30 seconds.\n\n**CLOSING OF THIS EPISODE (mandatory):**\n${closer.instruction}\nBoth mandatory elements (see you tomorrow, please recommend us) must be there, but freshly worded.`
    user += milestonePromptSection(episode, 'en')
    user += renderRegieSection(coords, fill, 'en')
    const worn = computeWornOut(recentScripts(), { excludeText: `${post.title}\n${post.content}` })
    writeFileSync(join(out, 'worn.json'), JSON.stringify(worn, null, 1))
    user += wornSection(worn, 'en')
    const system = buildPersonalityBrief(state)
    writeFileSync(join(out, 'system.txt'), system)
    writeFileSync(join(out, 'user.txt'), user)
    console.log(`Prompts: system ${system.length}, user ${user.length} Zeichen; Folge ${episode}; Regisseur ${fill ? 'ja' : 'nein'}; verbraucht ${worn.phrases.length}/${worn.shortLines.length}/${worn.directions.length}`)
    if (call) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const { scriptRequestBudget, extractScriptText } = await import('@/lib/podcast/script-diagnostics')
      const model = arg('model') ?? 'claude-opus-5-5'
      const message = await new Anthropic().messages.stream({
        model, system, messages: [{ role: 'user', content: user }],
        ...scriptRequestBudget(model, Math.max(12000, Math.round(maxWordCount * 3))),
      }).finalMessage()
      writeFileSync(join(out, 'script.txt'), extractScriptText(message))
      console.log(`Skript (${model}), stop_reason ${message.stop_reason}`)
    }
    return
  }

  if (stage === 'texture') {
    const coords = readJson<RegieCoordinates | null>(coordsFile, null)
    if (!coords) throw new Error(`${coordsFile} fehlt`)
    const script = readFileSync(join(out, 'script.txt'), 'utf-8')
    const { body, moments } = splitMomentsSection(script)
    const worn = readJson(join(out, 'worn.json'), computeWornOut(recentScripts()))
    const post = arg('post') ? readPost() : null
    const fill = post ? readFill(post.content, coords) : null
    const opts = {
      lang: 'en' as const, worn, coarseness: coarsenessInstruction(coords, 'en'), protectedQuotes: quotesFromMoments(moments),
      devices: textureDeviceNotes(coords, fill, 'en'),
      echoes: post ? articleEchoes(body, post.content) : [],
    }
    const { system, user } = buildTexturePrompt(body, opts)
    writeFileSync(join(out, 'texture-system.txt'), system)
    writeFileSync(join(out, 'texture-user.txt'), user)
    console.log(`Textur-Prompts: system ${system.length}, user ${user.length} Zeichen; Artikel-Echos ${opts.echoes.length}`)
    if (call) {
      const { applyTexturePass } = await import('@/lib/podcast/texture-pass')
      const res = await applyTexturePass(body, opts)
      writeFileSync(join(out, 'textured.txt'), res.script)
      console.log(`Texturdurchgang: ${res.applied ? 'übernommen' : `verworfen (${res.problems.join('; ')})`}`)
    }
    return
  }

  if (stage === 'validate') {
    const script = readFileSync(join(out, 'script.txt'), 'utf-8')
    const { body, moments } = splitMomentsSection(script)
    const revised = stripPreamble(readFileSync(join(out, 'textured.txt'), 'utf-8'))
    const check = validateTexture(body, revised, 'en', quotesFromMoments(moments))
    const final = (check.ok ? revised : body) + (moments ? `\n\n${moments}` : '')
    writeFileSync(join(out, 'final.txt'), final)
    writeFileSync(join(out, 'texture-check.json'), JSON.stringify(check, null, 1))
    console.log(check.ok ? 'Textur übernommen' : `Textur verworfen: ${check.problems.join('; ')}`)
    return
  }

  if (stage === 'record') {
    const coords = readJson<RegieCoordinates | null>(coordsFile, null)
    const file = arg('history')
    if (!coords || !file) throw new Error('coords.json oder --history fehlt')
    const history = readJson<RegieHistoryEntry[]>(file, [])
    writeFileSync(file, JSON.stringify(withEntry(history, { date: coords.date, postId: coords.postId, picks: coords.picks }), null, 1))
    console.log(`Historie: ${file}`)
    return
  }

  console.error('Stufe fehlt: director | script | texture | validate | record')
  process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
