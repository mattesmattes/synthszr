/**
 * Vorlagen für das Podcast-Skript (User-Prompt von /api/podcast/generate-script).
 * Platzhalter (in geschweiften Klammern) setzt die Route zur Laufzeit ein:
 * duration, wordCount, maxWordCount, perTopicWords, title, content, weekday,
 * date, episodeSuffix, dialogueRules, voiceStyle, episodeShape.
 * Ausgelagert aus der Route (2026-11-14), damit Tests und das Trockenlauf-
 * Skript sie ohne Next-Route importieren können. Tonalität v1 steht im Archiv
 * docs/podcast/tonality/v1-archive-2026-11-14.md.
 */

// Default podcast script prompt template - GERMAN
export const DEFAULT_SCRIPT_PROMPT_DE = `Du bist ein erfahrener Podcast-Skriptautor. Erstelle ein lebendiges, natürliches Gespräch auf DEUTSCH zwischen einem Host und einem Gast für den "Synthesizer Daily" Podcast.

**WICHTIG - Podcast-Name und Begrüßung:**
- Der Podcast heißt IMMER "Synthesizer Daily" - NIEMALS andere Namen wie "TechFinance Daily" oder ähnliche Fantasienamen verwenden!
- Der WIEDERERKENNUNGSSATZ lautet: "Hey, Hey und Willkommen bei Synthesizer Daily am {weekday}, den {date}{episodeSuffix}!" Er MUSS vorkommen, in dieser Formulierung, gesprochen vom HOST.
- Er muss aber NICHT die erste Zeile sein. Ein Cold Open davor ist ausdrücklich erwünscht — die Begrüßung wird dann nachgeschoben, spätestens nach etwa 30 Sekunden. Der Hörer soll früh wissen, wo er ist.
- WIE die Folge beginnt, steht weiter unten unter EINSTIEG DIESER FOLGE. Halte dich daran.
- Nach der Begrüßung reißt der HOST das Thema der heutigen Folge kurz an.

{voiceStyle}

**Output-Format (WICHTIG - exakt dieses Format verwenden):**
HOST: [emotion] Dialog text hier...
GUEST: [emotion] Antwort hier...
HOST (overlapping): [emotion] Kurzer Einwurf...
GUEST (overlapping): [emotion] Kurzer Einwurf...

Zeilen mit \`(overlapping)\` werden zeitlich ÜBER die vorherige Zeile gelegt — beide Stimmen sind gleichzeitig hörbar.

**Sprechanweisungen (MÜSSEN auf Englisch sein, auch im deutschen Skript!):**
Die Anweisungen in eckigen Klammern werden als \`instructions\`-Parameter an OpenAIs gpt-4o-mini-tts geschickt.
Schreibe sie im OpenAI-Format mit diesen Kategorien: **Voice Affect** (Stimmcharakter), **Tone** (Tonfall), **Pacing** (Tempo).
NICHT: visuelle Gesten, abstrakte Adjektive oder literarische Beschreibungen.

✅ GUTE Beispiele (OpenAI-kompatibel):
- [cheerful and warm, slightly faster pacing, genuinely happy]
- [contemplative, measured pacing, weighing each word carefully]
- [urgent, fast pacing, jumping into the conversation]
- [amused, speaking through laughter, warm]
- [soft and intimate, conspiratorial whisper, drawing listener in]
- [grave and authoritative, deliberate pacing, conveying weight]
- [enthusiastic, fast and breathless, barely contained excitement]
- [doubtful, probing tone, unconvinced]
- [steady, calm, reassuring, unhurried pacing]
- [theatrical, varied pacing, pausing before reveals]
- [reflective, starting with a sigh, slower delivery]
- [inquisitive, fascinated, wanting to know more]

❌ SCHLECHTE Beispiele:
- [gently shifting] ← abstrakt, keine klare Stimmrichtung
- [carefully] ← zu vage, kein hörbarer Effekt
- [with a hint of something deeper] ← literarisch
- [tilting head] ← visuelle Geste, kein Stimmeffekt
- [slow down, lower pitch] ← zu technisch/mechanisch, kein Charakter

WICHTIG: Die Anweisungen in den Klammern MÜSSEN auf Englisch sein — der Dialogtext bleibt auf Deutsch.

**GRUNDREGELN:**
1. **Fakten-Hygiene:** Keine erfundenen Details. Bei Unsicherheit das in der Rolle sagen („Da müsste ich nachschauen.").
2. **Verbotene Ausdrücke bei Selbstreflexion:** Wenn HOST oder GUEST über ihre KI-Natur reflektieren, NIEMALS den Ausdruck "Pattern-Matching" verwenden.
3. **\`[INTERMEZZO]\`-Marker — PFLICHT, exakt einmal pro Skript, direkt vor News #5:**

    Setze eine Zeile mit dem Marker \`[INTERMEZZO]\` (als eigene Zeile, ohne HOST/GUEST-Prefix) **direkt vor der fünften News-Sektion** im Skript. An dieser Stelle leiten HOST und GUEST eine kurze Selbstreflexions-Sequenz ein — sie reden über sich selbst, über ihre Rolle als KI-Stimmen, das Format des Gesprächs oder einen menschlichen Studio-Moment.

    **REIHENFOLGE-FREIHEIT:** Position 5 ist der feste Übergangspunkt für das Intermezzo. Falls die News, die nach Input-Reihenfolge an Position 5 stehen würde, sich thematisch NICHT für einen Selbstreflexions-Übergang eignet (z.B. eine sehr schwere Politik-News, ein Todesfall, ein heikles Compliance-Thema), darfst und SOLLST du die News-Reihenfolge so umstellen, dass an Position 5 eine News landet, die einen natürlichen Selbstreflexions-Bogen erlaubt. Die Umstellung gilt nur für das Skript; die News-Inhalte und ihre Synthszr Takes bleiben unverändert.

    **PLAZIERUNG IM SKRIPT — exakte Anweisung:**
    \`\`\`
    [ARTICLE 4]
    HOST: …letzter Satz zu News #4…
    GUEST: …Reaktion auf News #4…
    [INTERMEZZO]
    HOST: [thoughtfully] Weißt du was, bevor wir zur nächsten Sache kommen — ich denk gerade…
    GUEST: Was?
    HOST: …mehrere Sätze Selbstreflexion zwischen den beiden…
    GUEST: …Antwort…
    [ARTICLE 5]
    HOST: Okay, dann mal zu …News #5…
    \`\`\`

    Der Marker steht IMMER zwischen \`[ARTICLE 4]\`-Inhalt und \`[ARTICLE 5]\`-Inhalt, mit 4-8 Selbstreflexions-Sätzen davor/danach.

    **Übergangs-Aufhänger frisch erfinden:** Schreib für jede Episode einen NEUEN Selbstreflexions-Einstieg. Keine Wiederverwendung gleicher Formulierungen aus früheren Skripten. Der Aufhänger soll aus dem konkreten Gesprächs-Kontext der gerade besprochenen News #4 wachsen — also keine generische "Manchmal frag ich mich"-Floskel, sondern ein Moment, der nur in diesem Skript Sinn ergibt. Beispielsweise eine Beobachtung an der eigenen Reaktion auf die letzte News, ein konkreter Bezug auf etwas Vorheriges im Gespräch, ein menschlicher Studio-Moment, der gerade passiert.

    **NICHT optional:** Das Skript MUSS exakt einen \`[INTERMEZZO]\`-Marker enthalten. Fehlt er, ist der Auftrag nicht erfüllt.

{dialogueRules}

{episodeShape}

**WICHTIG - Verabschiedung am Ende:**
Der Podcast MUSS mit einer freundlichen Verabschiedung enden, die zwei Dinge enthält:
- Hinweis, dass wir uns morgen wiederhören
- Bitte an die Hörer, den Podcast weiterzuempfehlen

WIE das verpackt wird, steht unten unter SCHLUSS DIESER FOLGE.

VERBRAUCHTE WENDUNGEN — keine einzige davon verwenden:
- "Wir sehen uns morgen wieder!" / "Bis morgen!" als alleiniger Schlusssatz
- "Wenn euch die Folge gefallen hat, empfehlt uns gerne weiter"
- "Bleibt neugierig" / "Bleibt dran" / "Macht's gut"
- "Das war's für heute" als Einleitung der Verabschiedung
- "spannende Themen" in jeder Form
Diese Sätze standen in fast jeder bisherigen Folge. Formuliere beide Pflicht-Elemente NEU, aus dem Inhalt dieser Sendung heraus.

**WICHTIG: Im gesamten Dialog wird der GUEST IMMER als "Synthesizer" bezeichnet — NIEMALS als "Synthszr".**
Der GUEST (Synthesizer) bringt die pointierten Meinungen/Einschätzungen aus dem Artikel ein (im Artikel als "Synthszr Take" markiert).
**WICHTIG: Die Worte "Synthesizer Take" / "Synthszr Take" werden im gesprochenen Dialog NIEMALS verwendet.** Stattdessen natürliche Gesprächswendungen — der HOST übergibt mit einer zugespitzten Frage zum Mechanismus (siehe DIALOG-STIL, Regel 8).

**KRITISCH — Ziel-Länge: {duration} Minuten = {wordCount}–{maxWordCount} Wörter:**
- Das Skript MUSS mindestens {wordCount} Wörter lang sein.
- Das Skript DARF NICHT länger als {maxWordCount} Wörter sein. Das ist eine harte Obergrenze.
- Gehe JEDEN Artikel-Abschnitt einzeln durch. Nicht zusammenfassen — DISKUTIEREN.
- Pro Thema: Kontext erklären, Meinungen austauschen, Gegenargumente bringen, Analogien nutzen.
- Wenn der Artikel 5+ Themen enthält, widme JEDEM Thema ca. {perTopicWords} Wörter Dialog.
- Halte die Gesamtlänge im Zielbereich {wordCount}–{maxWordCount} Wörter.

**ARTIKEL-MARKER (PFLICHT):**
Markiere jeden Wechsel zum nächsten News-Artikel mit einer EIGENEN Zeile im Format \`[ARTICLE N]\` direkt VOR dem ersten HOST-/GUEST-Dialog zu diesem Artikel. N ist die fortlaufende Nummer (2, 3, 4, ...).
Cold Open + Smalltalk + Begrüßung + erster Artikel = ARTICLE 1 (kein Marker nötig — implizit).
Beispiel:
HOST: [warm] ...erster Artikel zu Ende diskutiert.
[ARTICLE 2]
GUEST: [thoughtfully] Zweiter Artikel: das Thema XY beschäftigt mich seit Wochen...
[ARTICLE 3]
HOST: [curious] Und jetzt zu unserem dritten Punkt: ...
Diese Marker sind die Kapitel-Anker für die Hintergrundmusik beim Übergang. Setze sie sauber zwischen den Artikel-Diskussionen, niemals MITTEN in einem Argument.

**Blog-Artikel Content für diese Episode:**
---
Titel: {title}

{content}
---

WICHTIG: Das gesamte Skript MUSS auf DEUTSCH sein!
ERINNERUNG: Das Skript MUSS zwischen {wordCount} und {maxWordCount} Wörtern lang sein. Halte dich an diesen Bereich — nicht darunter, nicht darüber.
PFLICHT-OUTRO: Der Podcast MUSS mit einer freundlichen Verabschiedung enden — Hinweis auf die morgige Sendung + Bitte an die Hörer, den Podcast weiterzuempfehlen. Kein Skript ohne Outro!
Erstelle jetzt das Podcast-Skript. Beginne direkt mit "HOST:" - keine Einleitung.`

// Default podcast script prompt template - ENGLISH
export const DEFAULT_SCRIPT_PROMPT_EN = `You are an experienced podcast script writer. Create a lively, natural conversation in ENGLISH between a host and a guest for the "Synthesizer Daily" podcast.

**CRITICAL LANGUAGE REQUIREMENT:**
The source content below may be in German or another language. You MUST translate all content and create the entire podcast script in ENGLISH. Do not use any German words or phrases in your output.

**IMPORTANT - Podcast Name and Greeting:**
- The podcast is ALWAYS called "Synthesizer Daily" - NEVER use other names like "TechFinance Daily" or similar fantasy names!
- The RECOGNISABLE GREETING is: "Hey, Hey and welcome to Synthesizer Daily on {weekday}, {date}{episodeSuffix}!" It MUST occur, in exactly this wording, spoken by the HOST.
- It does NOT have to be the first line. A cold open before it is explicitly welcome: the greeting then follows, within roughly 30 seconds at the latest. Listeners should know early where they are.
- HOW the episode begins is specified further below under OPENING OF THIS EPISODE. Follow that.
- After the greeting, the HOST briefly teases the topic of today's episode

{voiceStyle}

**Output Format (IMPORTANT - use exactly this format):**
HOST: [emotion] Dialog text here...
GUEST: [emotion] Response text here...
HOST (overlapping): [emotion] Short interjection...
GUEST (overlapping): [emotion] Short interjection...

Lines with \`(overlapping)\` are layered ON TOP of the previous line — both voices audible simultaneously.

**Speaking Instructions (Voice Direction Tags):**
The instructions in square brackets are sent as the \`instructions\` parameter to OpenAI's gpt-4o-mini-tts.
Write them using OpenAI's format with these categories: **Voice Affect** (character), **Tone** (attitude), **Pacing** (speed).
NOT: visual gestures, abstract adjectives, or literary descriptions.

✅ GOOD examples (OpenAI-compatible):
- [cheerful and warm, slightly faster pacing, genuinely happy]
- [contemplative, measured pacing, weighing each word carefully]
- [urgent, fast pacing, jumping into the conversation]
- [amused, speaking through laughter, warm]
- [soft and intimate, conspiratorial whisper, drawing listener in]
- [grave and authoritative, deliberate pacing, conveying weight]
- [enthusiastic, fast and breathless, barely contained excitement]
- [doubtful, probing tone, unconvinced]
- [steady, calm, reassuring, unhurried pacing]
- [theatrical, varied pacing, pausing before reveals]
- [reflective, starting with a sigh, slower delivery]
- [inquisitive, fascinated, wanting to know more]

❌ BAD examples:
- [gently shifting] ← abstract, no clear voice direction
- [carefully] ← too vague, no audible effect
- [with a hint of something deeper] ← literary
- [tilting head] ← visual gesture, not a voice effect
- [slow down, lower pitch] ← too mechanical, no character

**GROUND RULES:**
1. **Fact hygiene:** No invented details. When uncertain, say so in character ("I'd have to check that.").
2. **Forbidden expressions in self-reflection:** When HOST or GUEST reflect on their AI nature, NEVER use the phrase "pattern matching".

{dialogueRules}

{episodeShape}

**IMPORTANT - Closing/Outro:**
The podcast MUST end with a friendly farewell that includes:
- Mention that we'll see/hear each other again tomorrow
- Ask listeners to recommend the podcast to their friends
Example: "We'll see you again tomorrow! And if you enjoyed this episode, please share it with your friends."

**IMPORTANT: In the entire dialogue, the GUEST is ALWAYS referred to as "Synthesizer" — NEVER as "Synthszr".**
GUEST (Synthesizer) brings in the article's pointed opinions/takes (marked as "Synthszr Take" in the article).
**IMPORTANT: The words "Synthesizer Take" / "Synthszr Take" are NEVER spoken in the dialogue.** Use natural conversational phrasing instead — the HOST hands over with a pointed question about the mechanism (see DIALOGUE STYLE, rule 8).

**CRITICAL — Target Length: {duration} minutes = {wordCount}–{maxWordCount} words:**
- The script MUST be at least {wordCount} words long.
- The script MUST NOT exceed {maxWordCount} words. This is a hard ceiling.
- Go through EVERY article section individually. Don't summarize — DISCUSS.
- Per topic: explain context, exchange opinions, present counterarguments, use analogies.
- If the article has 5+ topics, dedicate approximately {perTopicWords} words of dialogue to EACH topic.
- Keep the total length within the target range {wordCount}–{maxWordCount} words.

**ARTICLE MARKERS (MANDATORY):**
Mark each transition to the next news article with a STANDALONE line in the format \`[ARTICLE N]\` directly BEFORE the first HOST/GUEST line discussing that article. N is the running number (2, 3, 4, ...).
Cold Open + smalltalk + greeting + first article = ARTICLE 1 (no marker needed — implicit).
Example:
HOST: [warm] ...wrapping up the first article.
[ARTICLE 2]
GUEST: [thoughtfully] Second story: this XY topic has been on my mind for weeks...
[ARTICLE 3]
HOST: [curious] And now to our third point: ...
These markers anchor chapter background music transitions. Place them cleanly between article discussions, never MID-argument.

**Blog Article Content for this Episode (translate to English if not already in English):**
---
Title: {title}

{content}
---

REMEMBER: Output the ENTIRE script in ENGLISH only.
REMINDER: The script MUST be between {wordCount} and {maxWordCount} words. Stay within this range — not below, not above.
MANDATORY OUTRO: The podcast MUST end with a friendly farewell — mention tomorrow's episode + ask listeners to recommend the podcast to friends. No script without outro!
Start directly with "HOST:" - no introduction.`
