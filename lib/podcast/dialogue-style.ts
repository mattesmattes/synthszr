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
 * Gesprochener Text in der Sprache der Vorlage, Sprechanweisungen immer
 * Englisch. Kein Gruß-Platzhalter im Beispiel: Den Einstieg regeln die
 * Eröffnungs-Modi (lib/podcast/openers.ts).
 */

export const DIALOGUE_STYLE_RULES_EN = `**DIALOGUE STYLE (how it sounds; every rule here is audible in the final mix, follow the mechanics exactly):**

1. One voice direction per line, at the very start, in square brackets, in English: voice affect + tone + pacing, e.g. [dry, unconvinced, slow]. It becomes the TTS instruction for that line. A second bracket later in the line is deleted before synthesis; to change tone mid-thought, start a new line.
2. Fillers are placed, not sprinkled. "So...", "Hmm", "you know", "well", "okay" open a thought or buy time before an opinion. At most one per turn, never the same filler in two consecutive turns, never inside a number or a name. No filler more than four times in the whole script.
3. Reactions are their own lines of one to three words: "Exactly.", "Wait, what?", "Hm.", "No way." The mixer overlaps short lines onto the previous speaker's tail; a reaction glued to a long sentence loses that.
4. Interruptions come in two forms. Cut-off: the interrupted line ends mid-thought with three dots ... (no other closing punctuation); the interrupter's line starts with (overlapping) and an urgent direction; the interrupted speaker finishes or drops the thought in the next line. Talk-over: HOST (overlapping): or GUEST (overlapping): for a line heard while the other is still speaking, under eight words. Both interrupt: GUEST when excited, HOST when GUEST gets long or vague. About one interruption per news item, not more.
5. Thinking pauses are written as ... inside the text: "That's... that's the part I don't buy." Never write [beat], [pause] or similar tags; they are stripped before synthesis and produce no silence.
6. A question ends with ? and gets a quick answer. The mixer tightens the gap after a question mark, so answer first, elaborate after.
7. Sentence length follows the job: one-liners for reactions and verdicts, two to four sentences for an explanation. No turn longer than four sentences without the other voice coming in (a reaction line counts).
8. The HOST opens every news item in her own words, one or two sentences, concrete: who, what, number, date. She never reads the article. She hands over with a pointed question about the mechanism, not with a generic "what do you think?".
9. The GUEST (Synthesizer) owns the opinions. The article's takes are his views, stated in first person ("I think the market is pricing in perfection"), never "the article says", never "Synthesizer take". He argues with a mechanism and a number, and he can be wrong and get corrected by the HOST.
10. Spoken text is plain text: no asterisks, no bold, no emoji, no stage directions in words ("laughs", "sighs"); put those into the bracket direction ([laughing]).
11. Studio moments happen in speech, not in tags: "Hold on, I marked that passage...", "Let me check that real quick...", "I'm just grabbing my coffee." At most two per episode, placed where someone genuinely looks something up or stalls. There are no sound effects in the mix, so a sip or a rustle is only real when it is said.

Example (mid-episode, handing over a news item):
HOST: [brisk, curious] Next one, and it's a number I had to read twice: Nvidia is lending money to the very companies that buy its chips. Why would a chip maker turn into a bank...
GUEST (overlapping): [urgent, jumping in] Because every idle GPU at a neocloud is an order that never comes back.
HOST: [skeptical, slower] Hm.
GUEST: [confident, steady] It's not charity. It's... think of it as Nvidia pre-buying its own next quarter.
HOST: [probing, unconvinced] And if one of those renters goes bust?
GUEST: [quick, flat] Then the chips come home. Plus the invoice.`

export const DIALOGUE_STYLE_RULES_DE = `**DIALOG-STIL (so klingt es; jede Regel hier ist im fertigen Mix hörbar, halte die Mechanik exakt ein):**

1. Eine Sprechanweisung pro Zeile, ganz am Anfang, in eckigen Klammern, auf Englisch: Stimmcharakter + Tonfall + Tempo, z. B. [dry, unconvinced, slow]. Sie wird zur TTS-Anweisung für diese Zeile. Eine zweite Klammer später in der Zeile wird vor der Synthese gelöscht; für einen Tonwechsel mitten im Gedanken beginnt eine neue Zeile.
2. Füllwörter werden gesetzt, nicht gestreut. „Also...", „Hmm", „weißt du", „naja", „okay" eröffnen einen Gedanken oder kaufen Zeit vor einer Meinung. Höchstens eins pro Turn, nie dasselbe in zwei Turns hintereinander, nie in einer Zahl oder einem Namen. Kein Füllwort öfter als viermal im ganzen Skript.
3. Reaktionen sind eigene Zeilen mit ein bis drei Wörtern: „Genau.", „Warte, was?", „Hm.", „Echt jetzt?" Der Mixer legt kurze Zeilen über das Ende der vorigen Stimme; eine Reaktion, die an einem langen Satz klebt, verliert das.
4. Unterbrechungen gibt es in zwei Formen. Abbruch: Die unterbrochene Zeile endet mitten im Gedanken mit drei Punkten ... (ohne weiteres Satzzeichen); die Zeile des Unterbrechers beginnt mit (overlapping) und einer drängenden Anweisung; wer unterbrochen wurde, führt den Gedanken in der nächsten Zeile zu Ende oder lässt ihn fallen. Reinreden: HOST (overlapping): oder GUEST (overlapping): für eine Zeile, die zu hören ist, während der andere noch spricht, unter acht Wörter. Beide unterbrechen: GUEST, wenn er sich aufregt, HOST, wenn GUEST lang oder vage wird. Etwa eine Unterbrechung pro News, nicht mehr.
5. Denkpausen stehen als ... im Text: „Das ist... das ist der Teil, den ich nicht kaufe." Niemals [beat], [pause] oder ähnliche Tags schreiben; sie werden vor der Synthese entfernt und erzeugen keine Stille.
6. Eine Frage endet mit ? und bekommt eine schnelle Antwort. Der Mixer zieht die Lücke nach einem Fragezeichen zusammen, also erst antworten, dann ausführen.
7. Die Satzlänge folgt der Aufgabe: Einzeiler für Reaktionen und Urteile, zwei bis vier Sätze für eine Erklärung. Kein Turn länger als vier Sätze, ohne dass die andere Stimme dazwischenkommt (eine Reaktionszeile zählt).
8. Die HOST eröffnet jede News in eigenen Worten, ein bis zwei Sätze, konkret: wer, was, Zahl, Datum. Sie liest nie den Artikel vor. Sie übergibt mit einer zugespitzten Frage zum Mechanismus, nicht mit einem allgemeinen „Wie siehst du das?".
9. Der GUEST (Synthesizer) besitzt die Meinungen. Die Takes des Artikels sind seine Ansichten, in Ich-Form („Ich glaube, der Markt preist Perfektion ein"), nie „der Artikel sagt", nie „Synthesizer Take". Er argumentiert mit Mechanismus und Zahl, und er darf falsch liegen und von der HOST korrigiert werden.
10. Gesprochener Text ist reiner Text: keine Sternchen, kein Fettdruck, keine Emojis, keine ausgeschriebenen Regieanweisungen („lacht", „seufzt"); die gehören in die Klammer-Anweisung ([laughing]).
11. Studio-Momente passieren im Sprechen, nicht in Tags: „Moment, das hab ich mir markiert...", „Warte, ich schau kurz nach...", „Ich hol mir eben meinen Kaffee." Höchstens zwei pro Folge, dort, wo jemand wirklich nachschlägt oder Zeit braucht. Geräusche gibt es im Mix nicht, ein Schluck oder Papier ist nur echt, wenn es gesagt wird.

Beispiel (mitten in der Folge, Übergabe einer News):
HOST: [brisk, curious] Nächste Sache, und das ist eine Zahl, die ich zweimal lesen musste: Nvidia leiht genau den Firmen Geld, die seine Chips kaufen. Warum wird ein Chiphersteller zur Bank...
GUEST (overlapping): [urgent, jumping in] Weil jede GPU, die bei einem Neocloud leer läuft, eine Bestellung ist, die nie zurückkommt.
HOST: [skeptical, slower] Hm.
GUEST: [confident, steady] Das ist keine Wohltätigkeit. Das ist... stell dir vor, Nvidia kauft sein eigenes nächstes Quartal vor.
HOST: [probing, unconvinced] Und wenn einer dieser Mieter pleitegeht?
GUEST: [quick, flat] Dann kommen die Chips nach Hause. Plus Rechnung.`
