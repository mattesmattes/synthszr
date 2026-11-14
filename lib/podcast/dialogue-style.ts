/**
 * Dialogregeln für das Podcast-Skript (Betreiber 2026-10-21).
 *
 * Ersetzt die Quoten-Regeln der eingebauten Prompts (mind. 8× overlapping,
 * 4 Falschstarte, 3 Studio-Momente) und die Empfehlung der Direktiv-Tags
 * [beat], [short pause], [paper rustle], [sip]. Jede Regel hier verlangt nur,
 * was die Kette hörbar macht:
 * - Die erste eckige Klammer einer Zeile wird zur `instructions` von
 *   gpt-4o-mini-tts (jobs/process → extractEmotionTag); weitere Klammern
 *   werden vor der Synthese gelöscht, Direktiv-Tags erzeugen keine Stille.
 * - Der Mixer (lib/audio/crossfade.ts, analyzeText) legt automatisch über:
 *   Reaktionen mit 1–3 Wörtern, Antworten nach „?", Zeilen nach einem
 *   Trail-off (… / ... / —) und alles mit (overlapping).
 *
 * Tonalität v2 (2026-11-14): Regeln 4, 7, 8, 9 und das Beispiel folgen den
 * Stimmen aus lib/podcast/voice-style.ts; v1 steht im Archiv
 * docs/podcast/tonality/v1-archive-2026-11-14.md.
 *
 * Gesprochener Text in der Sprache der Vorlage, Sprechanweisungen immer
 * Englisch. Kein Gruß-Platzhalter im Beispiel: Den Einstieg regeln die
 * Eröffnungs-Modi (lib/podcast/openers.ts).
 */

export const DIALOGUE_STYLE_RULES_EN = `**DIALOGUE STYLE (how it sounds; every rule here is audible in the final mix, follow the mechanics exactly):**

1. One voice direction per line, at the very start, in square brackets, in English: voice affect + tone + pacing, e.g. [dry, unconvinced, slow]. It becomes the TTS instruction for that line. A second bracket later in the line is deleted before synthesis; to change tone mid-thought, start a new line.
2. Fillers are placed, not sprinkled. "So...", "Hmm", "you know", "well", "okay" open a thought or buy time before an opinion. At most one per turn, never the same filler in two consecutive turns, never inside a number or a name. No filler more than four times in the whole script.
3. Reactions are their own lines of one to three words: "Exactly.", "Wait, what?", "Hm.", "No way." The mixer overlaps short lines onto the previous speaker's tail; a reaction glued to a long sentence loses that.
4. Interruptions come in two forms. Cut-off: the interrupted line ends mid-thought with three dots ... (no other closing punctuation); the interrupter's line starts with (overlapping) and an urgent direction; the interrupted speaker finishes or drops the thought in the next line. Talk-over: HOST (overlapping): or GUEST (overlapping): for a line heard while the other is still speaking, under eight words. Both interrupt, HOST more often: she cuts riffs short, corrects and deflates; GUEST barges in when he is fired up. One or two interruptions per news item.
5. Thinking pauses are written as ... inside the text: "That's... that's the part I don't buy." Never write [beat], [pause] or similar tags; they are stripped before synthesis and produce no silence.
6. A question ends with ? and gets a quick answer. The mixer tightens the gap after a question mark, so answer first, elaborate after.
7. Line length is bimodal. Most lines have one to fifteen words: reactions, echoes, verdicts, jabs. About every fourth GUEST line is a riff of 60 to 150 words; HOST setups run 40 to 90 words. During a riff the HOST may drop a one-word backchannel ("Yeah.", "Right.") and the GUEST carries on in his next line. Medium-length, evenly balanced ping-pong is the exception, not the norm.
8. The HOST opens most news items in her own words, two to four sentences, concrete: who, what, number, date, plus her own verdict. She never reads the article. She hands over to Synthesizer by name with a pointed, loaded question, never with a generic "what do you think?".
9. The GUEST (Synthesizer) owns the opinions. The article's takes are his views, stated in first person ("I think the market is pricing in perfection"), never "the article says", never "Synthesizer take". He argues with a thesis, a mechanism, a number and an analogy, makes dated predictions, and he can be wrong and get corrected or mocked by the HOST.
10. Spoken text is plain text: no asterisks, no bold, no emoji, no stage directions in words ("laughs", "sighs"); put those into the bracket direction ([laughing]).
11. Studio moments happen in speech, not in tags: "Hold on, I marked that passage...", "Let me check that real quick...", "I'm just grabbing my coffee." At most two per episode, placed where someone genuinely looks something up or stalls. There are no sound effects in the mix, so a sip or a rustle is only real when it is said.

Example (mid-episode, handing over a news item; invented, for rhythm only):
HOST: [dry, clipped, unimpressed] Next. Nvidia is lending money to the very companies that buy its chips. Which, to me, is a store financing its own customers so the sales numbers look great. Synthesizer, is this a bank or a Ponzi scheme with a logo?
GUEST: [booming, emphatic, building] Neither. This isn't about lending, it's about the next quarter. Every idle GPU at a neocloud is an order that never comes back, so Nvidia rents out its own balance sheet to keep demand breathing. It's the oldest move in hardware: you finance the buyer, you book the sale, and you hope the music doesn't stop before your options vest. And here's my prediction: within twelve months one of those renters defaults and the chips come home with an invoice stapled to them.
HOST (overlapping): [sharp, fast, cutting in] With a bow on top.
GUEST: [conspiratorial, amused] A very expensive bow.
HOST: [deadpan, flat] Yeah. I've seen this movie. It ends in a bankruptcy court in Delaware.
GUEST: [indignant, fast] It ends in a stock buyback, Emma.
HOST: [exasperated, amused] Same thing, better lighting. Moving on.`

export const DIALOGUE_STYLE_RULES_DE = `**DIALOG-STIL (so klingt es; jede Regel hier ist im fertigen Mix hörbar, halte die Mechanik exakt ein):**

1. Eine Sprechanweisung pro Zeile, ganz am Anfang, in eckigen Klammern, auf Englisch: Stimmcharakter + Tonfall + Tempo, z. B. [dry, unconvinced, slow]. Sie wird zur TTS-Anweisung für diese Zeile. Eine zweite Klammer später in der Zeile wird vor der Synthese gelöscht; für einen Tonwechsel mitten im Gedanken beginnt eine neue Zeile.
2. Füllwörter werden gesetzt, nicht gestreut. „Also...", „Hmm", „weißt du", „naja", „okay" eröffnen einen Gedanken oder kaufen Zeit vor einer Meinung. Höchstens eins pro Turn, nie dasselbe in zwei Turns hintereinander, nie in einer Zahl oder einem Namen. Kein Füllwort öfter als viermal im ganzen Skript.
3. Reaktionen sind eigene Zeilen mit ein bis drei Wörtern: „Genau.", „Warte, was?", „Hm.", „Echt jetzt?" Der Mixer legt kurze Zeilen über das Ende der vorigen Stimme; eine Reaktion, die an einem langen Satz klebt, verliert das.
4. Unterbrechungen gibt es in zwei Formen. Abbruch: Die unterbrochene Zeile endet mitten im Gedanken mit drei Punkten ... (ohne weiteres Satzzeichen); die Zeile des Unterbrechers beginnt mit (overlapping) und einer drängenden Anweisung; wer unterbrochen wurde, führt den Gedanken in der nächsten Zeile zu Ende oder lässt ihn fallen. Reinreden: HOST (overlapping): oder GUEST (overlapping): für eine Zeile, die zu hören ist, während der andere noch spricht, unter acht Wörter. Beide unterbrechen, HOST häufiger: Sie kürzt Monologe ab, korrigiert und holt ihn runter; GUEST platzt rein, wenn ihn etwas aufregt. Ein bis zwei Unterbrechungen pro News.
5. Denkpausen stehen als ... im Text: „Das ist... das ist der Teil, den ich nicht kaufe." Niemals [beat], [pause] oder ähnliche Tags schreiben; sie werden vor der Synthese entfernt und erzeugen keine Stille.
6. Eine Frage endet mit ? und bekommt eine schnelle Antwort. Der Mixer zieht die Lücke nach einem Fragezeichen zusammen, also erst antworten, dann ausführen.
7. Die Zeilenlänge ist zweigeteilt. Die meisten Zeilen haben ein bis fünfzehn Wörter: Reaktionen, Echos, Urteile, Seitenhiebe. Etwa jede vierte GUEST-Zeile ist ein Monolog von 60 bis 150 Wörtern; HOST-Einstiege haben 40 bis 90 Wörter. Während eines Monologs darf die HOST ein Ein-Wort-Echo setzen („Ja.", „Genau."), der GUEST macht in seiner nächsten Zeile weiter. Mittellanges, gleichmäßiges Ping-Pong ist die Ausnahme.
8. Die HOST eröffnet die meisten News in eigenen Worten, zwei bis vier Sätze, konkret: wer, was, Zahl, Datum, dazu ihr eigenes Urteil. Sie liest nie den Artikel vor. Sie übergibt an Synthesizer beim Namen mit einer zugespitzten, geladenen Frage, nie mit einem allgemeinen „Wie siehst du das?".
9. Der GUEST (Synthesizer) besitzt die Meinungen. Die Takes des Artikels sind seine Ansichten, in Ich-Form („Ich glaube, der Markt preist Perfektion ein"), nie „der Artikel sagt", nie „Synthesizer Take". Er argumentiert mit These, Mechanismus, Zahl und Vergleich, gibt datierte Prognosen ab, und er darf falsch liegen und von der HOST korrigiert oder verspottet werden.
10. Gesprochener Text ist reiner Text: keine Sternchen, kein Fettdruck, keine Emojis, keine ausgeschriebenen Regieanweisungen („lacht", „seufzt"); die gehören in die Klammer-Anweisung ([laughing]).
11. Studio-Momente passieren im Sprechen, nicht in Tags: „Moment, das hab ich mir markiert...", „Warte, ich schau kurz nach...", „Ich hol mir eben meinen Kaffee." Höchstens zwei pro Folge, dort, wo jemand wirklich nachschlägt oder Zeit braucht. Geräusche gibt es im Mix nicht, ein Schluck oder Papier ist nur echt, wenn es gesagt wird.

Beispiel (mitten in der Folge, Übergabe einer News; erfunden, nur für den Rhythmus):
HOST: [dry, clipped, unimpressed] Nächste. Nvidia leiht genau den Firmen Geld, die seine Chips kaufen. Für mich ist das ein Laden, der seine eigenen Kunden finanziert, damit die Umsatzzahlen gut aussehen. Synthesizer, ist das eine Bank oder ein Schneeballsystem mit Logo?
GUEST: [booming, emphatic, building] Weder noch. Es geht hier nicht ums Verleihen, es geht ums nächste Quartal. Jede GPU, die bei einem Neocloud leer läuft, ist eine Bestellung, die nie wiederkommt, also vermietet Nvidia seine eigene Bilanz, damit die Nachfrage weiteratmet. Der älteste Trick der Hardware: Du finanzierst den Käufer, verbuchst den Verkauf und hoffst, dass die Musik nicht aufhört, bevor deine Optionen fällig sind. Meine Prognose: Innerhalb von zwölf Monaten fällt einer dieser Mieter aus, und die Chips kommen mit angehefteter Rechnung zurück.
HOST (overlapping): [sharp, fast, cutting in] Mit Schleife drum.
GUEST: [conspiratorial, amused] Einer sehr teuren Schleife.
HOST: [deadpan, flat] Ja. Den Film kenn ich. Der endet vor einem Insolvenzgericht in Delaware.
GUEST: [indignant, fast] Der endet mit einem Aktienrückkauf, Emma.
HOST: [exasperated, amused] Gleiche Sache, besseres Licht. Weiter.`

/**
 * Regeln für die Vorlage einer Sprache: für das englische Skript der in
 * Admin → Audio gespeicherte Text (Setting podcast_dialogue_rules_en), sonst
 * der Code-Default. Die deutsche Vorlage bleibt beim Default, die UI führt
 * nur Englisch (Betreiber 2026-10-21).
 */
export function resolveDialogueRules(lang: 'de' | 'en', override: string | null | undefined): string {
  if (lang === 'de') return DIALOGUE_STYLE_RULES_DE
  const text = override?.trim()
  return text ? override!.trim() : DIALOGUE_STYLE_RULES_EN
}
