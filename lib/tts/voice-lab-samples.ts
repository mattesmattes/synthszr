/**
 * Beispielskripte für den Stimmtest (Betreiber 2026-11-16: „sicherstellen,
 * dass bei den deutschsprachigen Tests deutsche Beispieltexte gezeigt
 * werden“). Alle gespeicherten Folgen sind englisch (Stand 2026-11-16 kein
 * einziges deutsches Skript in post_podcasts oder podcast_jobs); ohne diese
 * Vorlage läse ein „deutscher“ Test englischen Text mit deutscher Besetzung.
 *
 * Beide Fassungen haben denselben Inhalt und Aufbau, damit Deutsch und
 * Englisch vergleichbar sind. Sie decken ab, was die Stimmen tragen müssen:
 * Begrüßung mit „Synthesizer“, Ausbruch, langer Monolog mit Fachwörtern und
 * Zahlen, Ein-Wort-Reaktionen ohne Anweisung, Laute ([chuckles],
 * [short pause]), Flüstern, Reinreden mit (overlapping), Abbruch mit ...,
 * ein ernster Satz. Inhalt erfunden, Anweisungen nach
 * lib/podcast/voice-directions.ts (englisch, nur wo sich der Klang ändert).
 */

import type { PodcastTTSLang } from '@/lib/tts/gemini-voices'

export const VOICE_LAB_SAMPLE_SCRIPTS: Record<PodcastTTSLang, string> = {
  de: `HOST: Hey, hey und willkommen bei Synthesizer Daily! Heute fange ich an, weil mir eine Meldung wirklich den Morgen verdorben hat.
GUEST: Na dann. Leg los.
HOST: [indignant, speaking fast] Nvidia leiht genau den Firmen Geld, die seine Chips kaufen. Ich meine, ernsthaft? Das ist Nvidia, das Leute dafür bezahlt, bei Nvidia einzukaufen. Und im Quartalsbericht steht das dann als Wachstum.
GUEST: [booming, emphatic] Ich red's dir nicht aus, ich sag dir, warum es genial ist und warum es in Tränen endet. Schau, jede GPU, die bei einem dieser Neoclouds leer läuft, ist eine Bestellung, die nie wiederkommt. Also vermietet Nvidia seine eigene Bilanz. Der Kunde kann nicht zahlen? Leih ihm das Geld. Leih ihm das Geld, verbuch den Verkauf, meld das Quartal mit vierzig Milliarden Umsatz. Genau das haben die Telekom-Ausrüster Ende der Neunziger gemacht, und dann kam die Technik in Kartons zurück. Derselbe Film, bessere Chips.
HOST: Ja.
GUEST: Das ist, wie dem Schwager das Auto zu finanzieren, damit er bei dir tankt.
HOST: [laughing, warm] Hör auf. [short pause] Okay, der war gut.
GUEST: [hushed, conspiratorial] Ich werde nach Wörtern bezahlt.
HOST: [worked up, talking fast] Nein, aber was mich ärgert: Der Aufsichtsrat weiß das. Also, die wissen das ganz genau, und keiner sagt was, weil die Aktie steigt...
GUEST (overlapping): [sharp and quick] Weil die Aktie steigt, genau.
HOST: Das ist keine Aufsicht. Das ist ein Fanclub.
GUEST: [slow and sincere] Okay. Da hast du recht. [chuckles] Das sage ich nicht oft.`,
  en: `HOST: Hey, hey and welcome to Synthesizer Daily! I'm going first today, because one story genuinely ruined my morning.
GUEST: Well then. Go.
HOST: [indignant, speaking fast] Nvidia is lending money to the very companies that buy its chips. I mean, seriously? That's Nvidia paying people to shop at Nvidia. And in the quarterly report it shows up as growth.
GUEST: [booming, emphatic] I won't talk you out of it, I'll tell you why it's genius and why it ends in tears. Look, every GPU sitting idle at one of these neoclouds is an order that never comes back. So Nvidia rents out its own balance sheet. Customer can't pay? Lend them the money. Lend them the money, book the sale, report the quarter with forty billion in revenue. That's exactly what the telecom equipment makers did in the late nineties, and then the gear came back in boxes. Same movie, better chips.
HOST: Yeah.
GUEST: It's like financing your brother-in-law's car so he fills up at your gas station.
HOST: [laughing, warm] Stop it. [short pause] Okay, that was good.
GUEST: [hushed, conspiratorial] I get paid by the word.
HOST: [worked up, talking fast] No, but here's what bugs me: the board knows this. Like, they know it exactly, and nobody says anything because the stock is up...
GUEST (overlapping): [sharp and quick] Because the stock is up, exactly.
HOST: That's not oversight. That's a fan club.
GUEST: [slow and sincere] Okay. You're right. [chuckles] I don't say that often.`,
}
