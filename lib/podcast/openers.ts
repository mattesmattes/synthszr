/**
 * Wie eine Folge anfängt und wie sie aufhört.
 *
 * BETREIBER-BEFUND 2026-08-15: Intro und Outro klangen jeden Tag gleich. Der
 * Grund stand im Prompt: Die erste Zeile war WÖRTLICH vorgeschrieben („MUSS
 * exakt so beginnen"), und beim Outro stand ein Beispielsatz, den das Modell
 * übernahm. Das war kein Stilproblem, sondern eine Anweisung — variieren war
 * gar nicht erlaubt.
 *
 * Statt eines festen Wortlauts gibt es jetzt MODI: klar beschriebene Arten,
 * eine Sendung zu beginnen und zu beenden. Je Folge wird einer gewählt.
 *
 * ROTIEREND, NICHT ZUFÄLLIG. Zufall wiederholt sich sichtbar — bei acht Modi
 * liegt die Chance, dass zwei aufeinanderfolgende Folgen gleich anfangen, bei
 * jedem Achtel. Über die Episodennummer durchlaufen sie stattdessen der Reihe
 * nach; derselbe Einstieg kommt erst nach acht Folgen wieder.
 */

export interface Mode {
  /** Kurzname für Protokoll und Gedächtnis. */
  key: string
  /** Was der Autor tun soll — in der Sprache des Prompts. */
  instruction: string
}

/**
 * Eröffnungen.
 *
 * BETREIBER-VORGABE: Ein Cold Open ist erlaubt, die Begrüßung muss aber
 * NACHGESCHOBEN werden — der Hörer soll nach wenigen Sekunden wissen, wo er
 * ist. Keiner dieser Modi darf die Begrüßung ersetzen, sie alle gehen ihr
 * voraus.
 */
export const OPENERS: Mode[] = [
  {
    key: 'mitten-im-gedanken',
    instruction: 'Steige MITTEN IM GESPRÄCH ein, als liefe die Aufnahme schon: ein halber Satz, eine Reaktion, ein Lachen über etwas, das wir nicht gehört haben. Erst danach fängt sich der HOST und begrüßt.',
  },
  {
    key: 'zahl-des-tages',
    instruction: 'Beginne mit der überraschendsten ZAHL aus den heutigen Meldungen — nackt, ohne Einordnung, als Frage an den GUEST ("Rate mal, wie viel …"). Die Auflösung kommt, dann die Begrüßung.',
  },
  {
    key: 'frage-die-offen-bleibt',
    instruction: 'Der HOST stellt dem GUEST eine Frage, die er ERST AM ENDE der Folge beantworten darf ("Halt, sag noch nichts — dazu kommen wir"). Dann Begrüßung. Der Bogen muss sich im Outro schließen.',
  },
  {
    key: 'rueckgriff-auf-gestern',
    instruction: 'Knüpfe an die VORIGE Folge an: eine These von gestern, die sich heute bestätigt oder blamiert hat. Nutze dafür das Episoden-Gedächtnis unten. Danach die Begrüßung.',
  },
  {
    key: 'widerspruch',
    instruction: 'HOST und GUEST sind sich vom ersten Satz an UNEINIG — über eine der heutigen Meldungen, nicht über Belangloses. Der Streit wird kurz angerissen, dann unterbricht sich der HOST selbst für die Begrüßung.',
  },
  {
    key: 'beobachtung-ausserhalb',
    instruction: 'Beginne mit einer Beobachtung, die NICHTS mit Technik zu tun hat (Wetter, Jahreszeit, eine Alltagsszene) und die sich als Bild für die Hauptmeldung entpuppt. Dann die Begrüßung.',
  },
  {
    key: 'korrektur',
    instruction: 'Der GUEST räumt einen Irrtum aus einer früheren Folge ein oder revidiert eine Einschätzung — selbstbewusst, nicht zerknirscht. Nutze das Episoden-Gedächtnis. Dann die Begrüßung.',
  },
  {
    key: 'was-heute-anders-ist',
    instruction: 'Der HOST benennt in einem Satz, was diese Folge von den letzten unterscheidet ("Heute ist ausnahmsweise mal …"). Kein Rückblick, eine Ansage. Dann die Begrüßung.',
  },
]

/** Verabschiedungen. Die Pflichtelemente (morgen wieder, Empfehlung) trägt der
 *  Prompt selbst — hier steht nur, WIE sie verpackt werden. */
export const CLOSERS: Mode[] = [
  {
    key: 'ausblick-konkret',
    instruction: 'Schließe mit einem KONKRETEN Ausblick auf morgen: ein Termin, eine erwartete Zahl, eine Entscheidung, die ansteht. Nicht "morgen wieder spannende Themen".',
  },
  {
    key: 'offene-frage',
    instruction: 'Schließe mit einer Frage an die Hörer, auf die es keine offensichtliche Antwort gibt — und lade dazu ein, sie zu beantworten.',
  },
  {
    key: 'letztes-wort-gast',
    instruction: 'Der GUEST bekommt das LETZTE WORT und setzt einen Satz, der für sich stehen kann. Der HOST verabschiedet danach knapp.',
  },
  {
    key: 'rueckbezug-anfang',
    instruction: 'Greife den EINSTIEG dieser Folge wieder auf und schließe den Bogen — besonders wenn am Anfang eine Frage offen blieb.',
  },
  {
    key: 'running-gag',
    instruction: 'Beende mit einem Rückbezug auf einen laufenden Gag der Sendung (siehe Episoden-Gedächtnis). Nur wenn wirklich einer existiert, sonst einen anderen Modus wählen.',
  },
  {
    key: 'nuechtern',
    instruction: 'Schließe betont NÜCHTERN und kurz — keine Aufregung, kein Ausrufezeichen. Der Kontrast zur Sendung ist die Pointe.',
  },
  {
    key: 'kleine-wette',
    instruction: 'HOST und GUEST schließen eine kleine WETTE auf einen Ausgang, den man in Wochen überprüfen kann. Sie wird protokolliert und irgendwann eingelöst.',
  },
]

/**
 * Der Modus dieser Folge.
 *
 * Über die Episodennummer, nicht über Zufall: So durchlaufen die Modi der Reihe
 * nach, und derselbe Einstieg kommt erst nach einer vollen Runde wieder.
 *
 * Die beiden Listen sind UNTERSCHIEDLICH LANG (8 Eröffnungen, 7 Schlüsse), und
 * das ist der eigentliche Trick. Ein blosser Versatz genügt nicht: Bei gleicher
 * Länge ist die Paarung für jede Folge fest, es gäbe also weiterhin nur acht
 * Kombinationen — jede „Widerspruch"-Folge endete immer gleich. Weil 7 und 8
 * teilerfremd sind, durchlaufen Einstieg und Schluss erst nach 56 Folgen
 * dieselbe Paarung wieder.
 */
export function pickOpener(episodeNumber: number): Mode {
  return OPENERS[mod(episodeNumber, OPENERS.length)]
}

export function pickCloser(episodeNumber: number): Mode {
  return CLOSERS[mod(episodeNumber * 3 + 1, CLOSERS.length)]
}

/** Modulo, das auch für negative und krumme Eingaben einen gültigen Index gibt. */
function mod(n: number, len: number): number {
  if (!Number.isFinite(n)) return 0
  return ((Math.floor(n) % len) + len) % len
}
