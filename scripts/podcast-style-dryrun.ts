/**
 * Trockenlauf für die Podcast-Tonalität (2026-11-14): baut System- und
 * User-Prompt so, wie /api/podcast/generate-script sie für das englische
 * Skript zusammensetzt, aus Dateien statt aus der Datenbank, und schreibt sie
 * nach --out. Mit --call und ANTHROPIC_API_KEY ruft es das Modell
 * (Use-Case-Default oder --model) und schreibt das Skript als script.txt.
 *
 *   npx tsx scripts/podcast-style-dryrun.ts --post post.txt --state state.json \
 *     --date 2026-11-14T08:15:11Z --out ./out [--minutes 15] [--call] [--model claude-opus-5-5]
 *
 * post.txt: erste Zeile „Title: …", danach der Klartext des Posts.
 * state.json: eine Zeile aus podcast_personality_state (locale en).
 *
 * Abweichungen von der Route: keine Wochen-Modi aus der DB (eingebaute
 * Einstiege/Schlüsse), keine „zuletzt gelaufen"-Liste, kein Episoden-
 * Gedächtnis, kein Smalltalk. Die Tonalität (Stimmen, Dialogregeln,
 * Folgenaufbau, Persönlichkeits-Brief) ist identisch.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SCRIPT_PROMPT_EN } from '@/lib/podcast/script-templates'
import { resolveDialogueRules } from '@/lib/podcast/dialogue-style'
import { EPISODE_SHAPE_EN, VOICE_STYLE_EN } from '@/lib/podcast/voice-style'
import { episodeGreetingSuffix, milestonePromptSection } from '@/lib/podcast/episode-number'
import { synthszrIssueNumber } from '@/lib/i18n/config'
import { pickCloser, pickOpener } from '@/lib/podcast/openers'
import { buildPersonalityBrief, type PersonalityState } from '@/lib/podcast/personality'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const postFile = arg('post')
const stateFile = arg('state')
const out = arg('out') ?? './podcast-dryrun'
if (!postFile || !stateFile) {
  console.error('Aufruf: --post post.txt --state state.json [--date ISO] [--out dir] [--minutes 15] [--call] [--model id]')
  process.exit(1)
}

const raw = readFileSync(postFile, 'utf-8')
const [firstLine, ...rest] = raw.split('\n')
const title = firstLine.replace(/^Title:\s*/, '').trim()
const content = rest.join('\n').trim()
const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as PersonalityState
const postDate = new Date(arg('date') ?? Date.now())
const minutes = Number(arg('minutes') ?? 15)
const wordCount = Math.round(minutes * 150)
const maxWordCount = Math.round(wordCount * 1.25)
const perTopicWords = Math.max(80, Math.round(wordCount / 7))

const weekday = postDate.toLocaleDateString('en-US', { weekday: 'long' })
const date = postDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const episode = synthszrIssueNumber(postDate)
const episodeSuffix = episodeGreetingSuffix(episode, 'en')

let user = DEFAULT_SCRIPT_PROMPT_EN
  .replaceAll('{duration}', String(minutes))
  .replaceAll('{wordCount}', String(wordCount))
  .replaceAll('{maxWordCount}', String(maxWordCount))
  .replaceAll('{perTopicWords}', String(perTopicWords))
  .replaceAll('{title}', title)
  .replaceAll('{content}', () => content)
  .replaceAll('{weekday}', weekday)
  .replaceAll('{date}', date)
  .replaceAll('{episodeSuffix}', episodeSuffix)
  .replaceAll('{dialogueRules}', () => resolveDialogueRules('en', null))
  .replaceAll('{voiceStyle}', () => VOICE_STYLE_EN)
  .replaceAll('{episodeShape}', () => EPISODE_SHAPE_EN)

const dayOfYear = Math.floor((postDate.getTime() - new Date(postDate.getFullYear(), 0, 0).getTime()) / 86_400_000)
const opener = pickOpener(dayOfYear)
const closer = pickCloser(dayOfYear)
user += `\n\n**OPENING OF THIS EPISODE (mandatory):**\n${opener.instruction}\nThe recognisable greeting follows AFTER that — within roughly 30 seconds.\n\n**CLOSING OF THIS EPISODE (mandatory):**\n${closer.instruction}\nBoth mandatory elements (see you tomorrow, please recommend us) must be there, but freshly worded.`
user += milestonePromptSection(episode, 'en')

const system = buildPersonalityBrief(state)

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'system.txt'), system)
writeFileSync(join(out, 'user.txt'), user)
console.log(`Prompts in ${out}: system ${system.length} Zeichen, user ${user.length} Zeichen; Einstieg "${opener.key}", Schluss "${closer.key}", Folge ${episode}`)

if (process.argv.includes('--call')) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { scriptRequestBudget, extractScriptText } = await import('@/lib/podcast/script-diagnostics')
  const model = arg('model') ?? 'claude-opus-5-5'
  const anthropic = new Anthropic()
  const message = await anthropic.messages.stream({
    model,
    system,
    messages: [{ role: 'user', content: user }],
    ...scriptRequestBudget(model, Math.max(12000, Math.round(maxWordCount * 3))),
  }).finalMessage()
  writeFileSync(join(out, 'script.txt'), extractScriptText(message))
  console.log(`Skript (${model}) in ${join(out, 'script.txt')}, stop_reason ${message.stop_reason}`)
}
