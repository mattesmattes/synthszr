/**
 * Sprechanweisungen im Podcast-Skript, geschrieben für Gemini 3.8 Flash TTS
 * (Betreiber 2026-11-16: „wichtig ist, dass die Sprechanweisungen im Skript
 * auf Gemini optimiert sind“). Ersetzt den Abschnitt im OpenAI-Format
 * („Voice Affect / Tone / Pacing“ für gpt-4o-mini-tts) in beiden Vorlagen.
 *
 * Grundlage ist Googles Doku „Speech generation“ (Stand 2026-11-16):
 * - Der Text wird wörtlich vorgelesen; Gefühl, Vortrag, Tempo und Lautstärke
 *   eines ganzen Turns gehören in `speech_metadata.style` (bei uns: die
 *   Klammer am Zeilenanfang, lib/tts/line-delivery.ts).
 * - Erst ohne style testen, dann kurze Angaben nur für Turns, die eine
 *   Anpassung brauchen; lange oder mehrteilige Angaben sind die häufigste
 *   Ursache für Stimm-Drift.
 * - Kein Alter, Geschlecht, Name oder dauerhafter Akzent im style, keine
 *   Meta-Anweisungen.
 * - Kurze Laute und Pausen stehen als Inline-Tag an der Stelle, an der sie
 *   passieren, englisch auch in anderen Sprachen.
 *
 * Befund an 20 Folgen (2026-11-16): 2.523 Anweisungen, Ø 2,1 Wörter, alle
 * Zeilen mit Anweisung, darunter Gesprächszüge ohne Klang („cutting in“,
 * „leaning in“, „holding ground“, „building“), mitten in der Zeile nur
 * zweimal „[beat]“.
 */

import { SCRIPT_VOCAL_CUES } from '@/lib/tts/line-delivery'

const CUES = SCRIPT_VOCAL_CUES.map((c) => `[${c}]`).join(', ')

export const VOICE_DIRECTIONS_EN = `**Voice directions (written for Gemini TTS):**
Each line is synthesised on its own with Gemini TTS. Gemini reads the spoken text strictly word for word; the bracket at the very start of a line becomes that line's style, i.e. how the whole turn sounds.
- Give a line a direction only when it should sound different from a plain, natural read: an outburst, laughing, sarcasm, a hushed aside, slowing down for one sincere sentence, speeding up in a rant. Plain statements, calm explanations and most short reactions carry no bracket; Gemini takes the feeling from the words. At most about half of all lines get one.
- A direction says how the line sounds, in two to five English words: a feeling plus pace or volume, e.g. [indignant, speaking fast], [laughing, warm], [dry and flat], [hushed, conspiratorial], [slow and sincere], [loud, exasperated], [amused, quick], [booming, emphatic], [sarcastic, slow], [excited, talking fast].
- Never in a direction: names, age, gender, accent or profession (they belong to the voice), gestures ("leaning in", "tilting head"), conversation moves without a sound ("cutting in", "holding ground", "building", "rolling"), five or more qualities, or format labels ("Voice Affect:", "Tone:", "Pacing:"). Long or abstract directions make the voice drift. Interruptions are written with ... and (overlapping); the mixer does the rest.
- At most one direction per line. For a new sound mid-thought, start a new line.
- A momentary sound goes exactly where it happens, inside the line, using only these cues: ${CUES}. Sparingly: at most one per line and about ten per episode. They become real sounds; any other bracket inside a line is deleted before synthesis.
- Directions and cues are always English.

✅ GOOD:
- HOST: [indignant, speaking fast] They lent the money to their own customers.
- GUEST: Fine. [chuckles] You got me there.
- HOST: Wait. Say that again.  ← no bracket: the words carry it
- GUEST: [slow and sincere] I was wrong about that one.

❌ BAD:
- [sharp, fast, cutting in] ← "cutting in" is a move, not a sound
- [conspiratorial, amused, leaning in] ← a gesture
- [booming, emphatic, building, gaining speed, conveying weight] ← too long, the voice drifts
- [Voice Affect: grave. Tone: earnest. Pacing: slow.] ← format labels
- [British accent] / [Emma, warm] ← accent, age, gender and names belong to the voice
- "... and then she laughs ..." ← a sound is a cue like [laughs], never words`

export const VOICE_DIRECTIONS_DE = `**Sprechanweisungen (geschrieben für Gemini-TTS; MÜSSEN auf Englisch sein, auch im deutschen Skript):**
Jede Zeile wird einzeln mit Gemini-TTS vertont. Gemini liest den gesprochenen Text wörtlich vor; die Klammer ganz am Anfang einer Zeile wird zum style dieser Zeile, also dazu, wie der ganze Turn klingt.
- Eine Zeile bekommt nur dann eine Anweisung, wenn sie anders klingen soll als ein schlichtes, natürliches Vorlesen: ein Ausbruch, Lachen, Sarkasmus, ein gedämpfter Einschub, langsamer werden für einen ernsten Satz, schneller werden im Ausbruch. Schlichte Aussagen, ruhige Erklärungen und die meisten kurzen Reaktionen haben keine Klammer; Gemini nimmt das Gefühl aus den Worten. Höchstens etwa die Hälfte aller Zeilen bekommt eine.
- Eine Anweisung sagt, wie die Zeile klingt, in zwei bis fünf englischen Wörtern: ein Gefühl plus Tempo oder Lautstärke, z. B. [indignant, speaking fast], [laughing, warm], [dry and flat], [hushed, conspiratorial], [slow and sincere], [loud, exasperated], [amused, quick], [booming, emphatic], [sarcastic, slow], [excited, talking fast].
- Nie in einer Anweisung: Namen, Alter, Geschlecht, Akzent oder Beruf (die gehören zur Stimme), Gesten („leaning in", „tilting head"), Gesprächszüge ohne Klang („cutting in", „holding ground", „building", „rolling"), fünf oder mehr Eigenschaften, Format-Etiketten („Voice Affect:", „Tone:", „Pacing:"). Lange oder abstrakte Anweisungen lassen die Stimme driften. Unterbrechungen entstehen durch ... und (overlapping); den Rest macht der Mixer.
- Höchstens eine Anweisung pro Zeile. Für einen neuen Klang mitten im Gedanken beginnt eine neue Zeile.
- Ein kurzer Laut steht genau dort, wo er passiert, mitten in der Zeile, und nur mit diesen Hinweisen: ${CUES}. Sparsam: höchstens einer pro Zeile und etwa zehn pro Folge. Sie werden zu echten Lauten; jede andere Klammer mitten in der Zeile wird vor der Synthese gelöscht.
- Anweisungen und Hinweise sind immer englisch, der Dialogtext bleibt deutsch.

✅ GUT:
- HOST: [indignant, speaking fast] Die haben ihren eigenen Kunden das Geld geliehen.
- GUEST: Na gut. [chuckles] Erwischt.
- HOST: Moment. Sag das noch mal.  ← keine Klammer: die Worte tragen es
- GUEST: [slow and sincere] Da lag ich falsch.

❌ SCHLECHT:
- [sharp, fast, cutting in] ← „cutting in" ist ein Gesprächszug, kein Klang
- [conspiratorial, amused, leaning in] ← eine Geste
- [booming, emphatic, building, gaining speed, conveying weight] ← zu lang, die Stimme driftet
- [Voice Affect: grave. Tone: earnest. Pacing: slow.] ← Format-Etiketten
- [British accent] / [Emma, warm] ← Akzent, Alter, Geschlecht und Namen gehören zur Stimme
- „... und dann lacht sie ..." ← ein Laut ist ein Hinweis wie [laughs], nie Text`
