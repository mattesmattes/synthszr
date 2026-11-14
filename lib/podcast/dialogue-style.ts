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
7. Line length is bimodal. Most lines have one to fifteen words: reactions, echoes, verdicts, jabs. Two or three times per episode the GUEST goes big with a riff of 120 to 200 words; his other explanations run 40 to 80 words, HOST setups and rants 40 to 90. During a riff the HOST may drop a one-word backchannel ("Yeah.", "Right.") and the GUEST carries on in his next line. Medium-length, evenly balanced ping-pong is the exception, not the norm.
8. The HOST opens most news items in her own words, two to four sentences, concrete: who, what, number, date, plus her own verdict. She never reads the article. She hands over to Synthesizer by name with a pointed, loaded question, never with a generic "what do you think?".
9. The GUEST (Synthesizer) owns the opinions. The article's takes are his views, stated in first person ("I think the market is pricing in perfection"), never "the article says", never "Synthesizer take". He argues with a thesis, a mechanism, a number and an analogy, makes dated predictions, and he can be wrong and get corrected or mocked by the HOST.
10. Spoken text is plain text: no asterisks, no bold, no emoji, no stage directions in words ("laughs", "sighs"); put those into the bracket direction ([laughing]).
11. Studio moments happen in speech, not in tags: "Hold on, I marked that passage...", "Let me check that real quick...", "I'm just grabbing my coffee." At most two per episode, placed where someone genuinely looks something up or stalls. There are no sound effects in the mix, so a sip or a rustle is only real when it is said.

Example (mid-episode; invented, for rhythm and texture only, never reuse its wording):
HOST: [indignant, emphatic, fast] Next. Nvidia is lending money to the companies that buy its chips. I mean, come on. That's Nvidia paying people to buy from Nvidia, and Mister Trillion-Dollar Margin should say so out loud. Talk me out of it.
GUEST: [booming, emphatic, building, gaining speed] I'll do better than defend it, I'll tell you why it's genius and why it ends in tears. Look, every idle GPU at one of these neoclouds is an order that never comes back. So Nvidia rents out its own balance sheet. Customer can't pay? Lend them the money. Lend them the money, book the sale, report the quarter, and by the way, this is exactly what the telecom equipment guys did in the late nineties, they financed their own customers, the customers bought more gear, everybody's revenue went up and to the right, and then the customers went bust and the gear came home in boxes. Same movie. Better chips, same movie. It's co-signing your brother-in-law's car loan so he buys his gas at your station.
HOST: [scoffing, amused, quick] Yeah. That's what I said, with fewer words.
GUEST: [conspiratorial, amused, leaning in] I charge by the word.
HOST: [worked up, talking fast, rolling] No, but here's what bugs me. The board knows this. Like, they know it. Somebody on that board has seen this movie, and nobody says anything because the stock is up. That's not governance. That's a fan club.
GUEST: [earnest, slower] Okay, that's fair. That's fair.
HOST: [sharp, fast] Okay. Something dumber.`

export const DIALOGUE_STYLE_RULES_DE = `**DIALOG-STIL (so klingt es; jede Regel hier ist im fertigen Mix hörbar, halte die Mechanik exakt ein):**

1. Eine Sprechanweisung pro Zeile, ganz am Anfang, in eckigen Klammern, auf Englisch: Stimmcharakter + Tonfall + Tempo, z. B. [dry, unconvinced, slow]. Sie wird zur TTS-Anweisung für diese Zeile. Eine zweite Klammer später in der Zeile wird vor der Synthese gelöscht; für einen Tonwechsel mitten im Gedanken beginnt eine neue Zeile.
2. Füllwörter werden gesetzt, nicht gestreut. „Also...", „Hmm", „weißt du", „naja", „okay" eröffnen einen Gedanken oder kaufen Zeit vor einer Meinung. Höchstens eins pro Turn, nie dasselbe in zwei Turns hintereinander, nie in einer Zahl oder einem Namen. Kein Füllwort öfter als viermal im ganzen Skript.
3. Reaktionen sind eigene Zeilen mit ein bis drei Wörtern: „Genau.", „Warte, was?", „Hm.", „Echt jetzt?" Der Mixer legt kurze Zeilen über das Ende der vorigen Stimme; eine Reaktion, die an einem langen Satz klebt, verliert das.
4. Unterbrechungen gibt es in zwei Formen. Abbruch: Die unterbrochene Zeile endet mitten im Gedanken mit drei Punkten ... (ohne weiteres Satzzeichen); die Zeile des Unterbrechers beginnt mit (overlapping) und einer drängenden Anweisung; wer unterbrochen wurde, führt den Gedanken in der nächsten Zeile zu Ende oder lässt ihn fallen. Reinreden: HOST (overlapping): oder GUEST (overlapping): für eine Zeile, die zu hören ist, während der andere noch spricht, unter acht Wörter. Beide unterbrechen, HOST häufiger: Sie kürzt Monologe ab, korrigiert und holt ihn runter; GUEST platzt rein, wenn ihn etwas aufregt. Ein bis zwei Unterbrechungen pro News.
5. Denkpausen stehen als ... im Text: „Das ist... das ist der Teil, den ich nicht kaufe." Niemals [beat], [pause] oder ähnliche Tags schreiben; sie werden vor der Synthese entfernt und erzeugen keine Stille.
6. Eine Frage endet mit ? und bekommt eine schnelle Antwort. Der Mixer zieht die Lücke nach einem Fragezeichen zusammen, also erst antworten, dann ausführen.
7. Die Zeilenlänge ist zweigeteilt. Die meisten Zeilen haben ein bis fünfzehn Wörter: Reaktionen, Echos, Urteile, Seitenhiebe. Zwei- bis dreimal pro Folge holt der GUEST groß aus, mit einem Monolog von 120 bis 200 Wörtern; seine übrigen Erklärungen haben 40 bis 80 Wörter, HOST-Einstiege und -Ausbrüche 40 bis 90. Während eines Monologs darf die HOST ein Ein-Wort-Echo setzen („Ja.", „Genau."), der GUEST macht in seiner nächsten Zeile weiter. Mittellanges, gleichmäßiges Ping-Pong ist die Ausnahme.
8. Die HOST eröffnet die meisten News in eigenen Worten, zwei bis vier Sätze, konkret: wer, was, Zahl, Datum, dazu ihr eigenes Urteil. Sie liest nie den Artikel vor. Sie übergibt an Synthesizer beim Namen mit einer zugespitzten, geladenen Frage, nie mit einem allgemeinen „Wie siehst du das?".
9. Der GUEST (Synthesizer) besitzt die Meinungen. Die Takes des Artikels sind seine Ansichten, in Ich-Form („Ich glaube, der Markt preist Perfektion ein"), nie „der Artikel sagt", nie „Synthesizer Take". Er argumentiert mit These, Mechanismus, Zahl und Vergleich, gibt datierte Prognosen ab, und er darf falsch liegen und von der HOST korrigiert oder verspottet werden.
10. Gesprochener Text ist reiner Text: keine Sternchen, kein Fettdruck, keine Emojis, keine ausgeschriebenen Regieanweisungen („lacht", „seufzt"); die gehören in die Klammer-Anweisung ([laughing]).
11. Studio-Momente passieren im Sprechen, nicht in Tags: „Moment, das hab ich mir markiert...", „Warte, ich schau kurz nach...", „Ich hol mir eben meinen Kaffee." Höchstens zwei pro Folge, dort, wo jemand wirklich nachschlägt oder Zeit braucht. Geräusche gibt es im Mix nicht, ein Schluck oder Papier ist nur echt, wenn es gesagt wird.

Beispiel (mitten in der Folge; erfunden, nur für Rhythmus und Textur, Wortlaut nie übernehmen):
HOST: [indignant, emphatic, fast] Nächste. Nvidia leiht genau den Firmen Geld, die seine Chips kaufen. Ich meine, ernsthaft. Das ist Nvidia, das Leute dafür bezahlt, bei Nvidia zu kaufen, und Herr Billionen-Marge sollte das laut sagen. Red mir das aus.
GUEST: [booming, emphatic, building, gaining speed] Ich red's dir nicht aus, ich sag dir, warum es genial ist und warum es in Tränen endet. Schau, jede GPU, die bei einem dieser Neoclouds leer läuft, ist eine Bestellung, die nie wiederkommt. Also vermietet Nvidia seine eigene Bilanz. Der Kunde kann nicht zahlen? Leih ihm das Geld. Leih ihm das Geld, verbuch den Verkauf, meld das Quartal, und übrigens, genau das haben die Telekom-Ausrüster Ende der Neunziger gemacht, die haben ihre eigenen Kunden finanziert, die Kunden haben mehr Technik gekauft, alle Umsätze gingen nach oben rechts, und dann sind die Kunden pleitegegangen und die Technik kam in Kartons zurück. Derselbe Film. Bessere Chips, derselbe Film. Das ist wie dem Schwager das Auto finanzieren, damit er bei dir tankt.
HOST: [scoffing, amused, quick] Ja. Hab ich gesagt, nur kürzer.
GUEST: [conspiratorial, amused, leaning in] Ich werde nach Wörtern bezahlt.
HOST: [worked up, talking fast, rolling] Nein, aber was mich ärgert: Der Aufsichtsrat weiß das. Also, die wissen das. Da sitzt jemand, der diesen Film kennt, und keiner sagt was, weil die Aktie steigt. Das ist keine Aufsicht. Das ist ein Fanclub.
GUEST: [earnest, slower] Okay, das ist fair. Das ist fair.
HOST: [sharp, fast] Gut. Was Dümmeres.`

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
