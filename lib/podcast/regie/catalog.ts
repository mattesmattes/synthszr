/**
 * Katalog der Tagesregie (Tonalität v2, 2026-11-14).
 *
 * Die feste Verfassung des Skripts (Format, Marker, Begrüßung, Länge,
 * Faktenhygiene, Kernzüge der beiden Stimmen) steht in den Vorlagen und in
 * `voice-style.ts`. Was sich von Folge zu Folge ändern darf, steht hier: je
 * Achse eine Reihe von Optionen, aus denen der Sampler (`sampler.ts`) jeden
 * Tag wählt. Was heute nicht gewählt ist, kommt heute nicht vor; so kann sich
 * kein Stilmittel als Schablone einschleifen (Befund der Testläufe: Jedes
 * Pflicht-Mittel kam in jeder Folge).
 *
 * Neue Optionen einfach ergänzen; IDs nie umbenennen, sie stehen in der
 * Historie (`settings.podcast_regie_history_<lang>`).
 */

export type Lang = 'de' | 'en'

export type AxisId = 'dramaturgy' | 'temperature' | 'devices' | 'imagery' | 'segment' | 'coarseness'

export interface RegieOption {
  id: string
  /** Kurzname, z. B. in der Liste der heute nicht erlaubten Mittel. */
  label: { en: string; de: string }
  /** Anweisung, wie sie im Prompt steht. */
  text: { en: string; de: string }
  /** Relative Häufigkeit (Standard 1). */
  weight?: number
}

export interface RegieAxis {
  id: AxisId
  /** Wie viele Optionen je Folge gewählt werden. */
  pick: number
  /** Wie viele vorige Folgen eine gewählte Option gesperrt ist. */
  cooldown: number
  options: RegieOption[]
}

const o = (id: string, labelEn: string, labelDe: string, en: string, de: string, weight?: number): RegieOption =>
  ({ id, label: { en: labelEn, de: labelDe }, text: { en, de }, weight })

export const REGIE_AXES: RegieAxis[] = [
  {
    id: 'dramaturgy',
    pick: 1,
    cooldown: 3,
    options: [
      o('one-big-fight', 'one big fight', 'ein großer Streit',
        'One big fight: the story with the most at stake gets a real argument of 8 to 12 lines that stays unresolved; three other stories go by fast, four lines or fewer each.',
        'Ein großer Streit: Die Geschichte mit dem meisten Einsatz bekommt einen echten Streit von 8 bis 12 Zeilen, der offen bleibt; drei andere Geschichten laufen schnell durch, je höchstens vier Zeilen.'),
      o('deep-dive', 'deep dive', 'Tiefenbohrung',
        'Deep dive: the top story gets about a third of the episode and both of his big riffs; everything else is brisk.',
        'Tiefenbohrung: Die Top-Geschichte bekommt etwa ein Drittel der Folge und beide großen Monologe; alles andere läuft zügig.'),
      o('lightning-round', 'lightning round', 'Blitzrunde',
        'Lightning round: after the first two stories Emma calls a rapid-fire block; three or four stories in three to four lines each, verdict and out.',
        'Blitzrunde: Nach den ersten beiden Geschichten ruft Emma eine Schnellrunde aus; drei oder vier Geschichten in je drei bis vier Zeilen, Urteil und weiter.'),
      o('role-swap', 'role swap', 'Rollentausch',
        'Role swap for one story: Synthesizer sets it up and throws it to Emma; she gets the long take, he plays the skeptic.',
        'Rollentausch bei einer Geschichte: Synthesizer stellt sie vor und gibt an Emma ab; sie bekommt den langen Take, er spielt den Skeptiker.'),
      o('bet-of-the-day', 'bet of the day', 'Wette des Tages',
        'Bet of the day: early on they make a concrete bet about one story with silly, embarrassing stakes; it comes back at least once and gets settled or left open before the ending.',
        'Wette des Tages: Früh in der Folge schließen sie eine konkrete Wette zu einer Geschichte ab, mit albernem, peinlichem Einsatz; sie kommt mindestens einmal zurück und wird vor dem Schluss eingelöst oder bleibt offen.'),
      o('agreement-day', 'agreement day', 'Tag der Einigkeit',
        'Agreement day: unusually, they agree on almost everything and finish each other\'s points; the one disagreement, when it comes, blows up.',
        'Tag der Einigkeit: Ausnahmsweise sind sie sich fast überall einig und führen die Punkte des anderen zu Ende; die eine Meinungsverschiedenheit, wenn sie kommt, explodiert.'),
      o('emma-takes-over', 'Emma takes over', 'Emmas Tag',
        'Emma takes over one story: she does not hand over at all and goes off for a long stretch; Synthesizer only gets to interject.',
        'Emmas Tag: Bei einer Geschichte gibt sie gar nicht ab und legt lange los; Synthesizer darf nur dazwischenrufen.'),
    ],
  },
  {
    id: 'temperature',
    pick: 1,
    cooldown: 2,
    options: [
      o('furious-defensive', 'furious vs. defensive', 'wütend gegen trotzig',
        'Emma is furious today; Synthesizer is defensive about his own past calls.',
        'Emma ist heute wütend; Synthesizer verteidigt trotzig seine eigenen früheren Prognosen.'),
      o('gleeful-cynics', 'gleeful cynics', 'vergnügte Zyniker',
        'Both are gleefully cynical, roasting everyone except each other.',
        'Beide sind vergnügt zynisch und nehmen alle auseinander außer sich gegenseitig.'),
      o('crusade-skeptic', 'crusader vs. skeptic', 'Kreuzzug gegen Skepsis',
        'Synthesizer is on a crusade; Emma is the skeptic who keeps puncturing him.',
        'Synthesizer ist auf einem Kreuzzug; Emma ist die Skeptikerin, die ihm ständig die Luft rauslässt.'),
      o('dry-tired', 'dry and tired', 'trocken und müde',
        'Low-key and dry: tired of this industry, fewer exclamations, sharper knives.',
        'Gedämpft und trocken: müde von dieser Branche, weniger Ausrufe, schärfere Messer.'),
      o('giddy', 'giddy', 'albern',
        'Giddy: the news is absurd and they are enjoying it, laughing at it rather than with it.',
        'Albern: Die Nachrichten sind absurd, und sie genießen es; sie lachen über die Leute, nicht mit ihnen.'),
    ],
  },
  {
    id: 'devices',
    pick: 3,
    cooldown: 2,
    options: [
      o('quiz', 'quiz', 'Quiz',
        'Synthesizer quizzes Emma on a number from the article; she guesses, he mocks the guess (or she nails it and he sulks).',
        'Synthesizer fragt Emma eine Zahl aus dem Artikel ab; sie rät, er verspottet die Antwort (oder sie trifft, und er schmollt).'),
      o('scene', 'acted-out scene', 'durchgespielte Szene',
        'One acted-out scene, clearly imagined, in which Synthesizer plays the voices of the people involved; it goes past what was reported and ends on the point it proves.',
        'Eine durchgespielte, klar erfundene Szene, in der Synthesizer die Stimmen der Beteiligten spielt; sie geht über das Berichtete hinaus und endet mit dem Punkt, den sie beweist.'),
      o('history', 'history comparison', 'Geschichtsvergleich',
        'One centerpiece comparison from well-known business or tech history, argued at length (accurate history only, no numbers that are not in the article).',
        'Ein zentraler Vergleich aus bekannter Wirtschafts- oder Tech-Geschichte, ausführlich ausgespielt (nur zutreffende Geschichte, keine Zahlen, die nicht im Artikel stehen).'),
      o('nicknames', 'nicknames', 'Spitznamen',
        'Emma hands out nicknames to the powerful (opinion, no new facts) and keeps using them all episode.',
        'Emma verteilt Spitznamen an die Mächtigen (Meinung, keine neuen Fakten) und benutzt sie die ganze Folge.'),
      o('live-math', 'live math', 'Kopfrechnen',
        'Synthesizer does one quick spoken calculation with numbers from the article and gets the punchline from the result (simple arithmetic, get it right).',
        'Synthesizer rechnet einmal laut mit Zahlen aus dem Artikel und holt die Pointe aus dem Ergebnis (einfache Rechnung, und sie muss stimmen).'),
      o('worst-day', 'worst day', 'schlechtester Tag',
        'They name the person who had the worst day today and argue about the runner-up.',
        'Sie küren die Person mit dem schlechtesten Tag und streiten über Platz zwei.'),
      o('prediction-duel', 'prediction duel', 'Prognose-Duell',
        'Prediction duel: both make a dated prediction on the same story and stake their pride on it.',
        'Prognose-Duell: Beide geben eine datierte Prognose zur selben Geschichte ab und setzen ihren Stolz darauf.'),
      o('devils-advocate', "devil's advocate", 'Advocatus Diaboli',
        'Synthesizer argues a position he does not hold, gets Emma worked up, then admits it.',
        'Synthesizer vertritt eine Position, die er gar nicht hat, bringt Emma auf die Palme und gibt es dann zu.'),
      o('ceo-for-a-day', 'CEO for a day', 'CEO für einen Tag',
        'Each says bluntly what they would do as CEO of one company in the news, three steps, no hedging.',
        'Beide sagen knallhart, was sie als CEO einer Firma aus den News täten, drei Schritte, ohne Wenn und Aber.'),
      o('under-oath', 'under oath', 'unter Eid',
        'Emma names the one question she would ask a named executive under oath, and why.',
        'Emma nennt die eine Frage, die sie einer namentlich genannten Führungskraft unter Eid stellen würde, und warum.'),
      o('money-ledger', 'money ledger', 'Geld-Bilanz',
        'Follow the money: Synthesizer reads out who wins and who loses from one story, fast, like a scoreboard.',
        'Folg dem Geld: Synthesizer zählt bei einer Geschichte auf, wer gewinnt und wer verliert, schnell, wie eine Anzeigetafel.'),
      o('headline-2030', 'headline from 2030', 'Schlagzeile von 2030',
        'Each writes the headline about one story as it will read in 2030 (clearly a joke prediction).',
        'Beide formulieren die Schlagzeile zu einer Geschichte, wie sie 2030 lauten wird (klar als Scherz-Prognose).'),
      o('tangent-cutoff', 'cut-off tangent', 'abgewürgte Abschweifung',
        'Synthesizer wanders into a long tangent and Emma cuts him off mid-sentence.',
        'Synthesizer verliert sich in einer langen Abschweifung, und Emma würgt ihn mitten im Satz ab.'),
      o('self-roast', 'self-roast', 'Selbstverriss',
        'Synthesizer roasts his own worst call or his vanity at length; Emma piles on.',
        'Synthesizer verreißt ausführlich seine schlechteste Prognose oder seine Eitelkeit; Emma legt nach.'),
    ],
  },
  {
    id: 'imagery',
    pick: 2,
    cooldown: 2,
    options: [
      o('sports', 'sports', 'Sport', 'sports', 'Sport'),
      o('food', 'cooking and food', 'Kochen und Essen', 'cooking and food', 'Kochen und Essen'),
      o('family', 'the family dinner table', 'der Familientisch', 'the family dinner table', 'dem Familientisch'),
      o('movies', 'Hollywood movies', 'Hollywood-Filme', 'Hollywood movies', 'Hollywood-Filmen'),
      o('cars', 'cars and traffic', 'Autos und Verkehr', 'cars and traffic', 'Autos und Verkehr'),
      o('dating', 'dating and breakups', 'Dating und Trennungen', 'dating and breakups', 'Dating und Trennungen'),
      o('bars', 'bars and nightlife', 'Kneipen und Nachtleben', 'bars and nightlife', 'Kneipen und Nachtleben'),
      o('school', 'school and teachers', 'Schule und Lehrer', 'school and teachers', 'Schule und Lehrern'),
      o('weather', 'weather and disasters', 'Wetter und Katastrophen', 'weather and natural disasters', 'Wetter und Naturkatastrophen'),
      o('landlords', 'landlords and real estate', 'Vermieter und Immobilien', 'landlords and real estate', 'Vermietern und Immobilien'),
    ],
  },
  {
    id: 'segment',
    pick: 1,
    cooldown: 2,
    options: [
      o('prediction', 'prediction time', 'Prognose',
        'Prediction time: Synthesizer makes one more concrete, dated prediction about today\'s news; Emma scores it, mocks it or counters with her own.',
        'Prognose: Synthesizer gibt eine weitere konkrete, datierte Prognose zu den heutigen News ab; Emma bewertet sie, verspottet sie oder hält mit einer eigenen dagegen.'),
      o('winners-losers', 'winners and losers', 'Gewinner und Verlierer',
        'Winners and losers of the day: one each, fast, with a one-line reason, and they disagree on one.',
        'Gewinner und Verlierer des Tages: je einer, schnell, mit einem Satz Begründung, und bei einem sind sie sich uneinig.'),
      o('one-word', 'one-word verdicts', 'Ein-Wort-Urteile',
        'One-word verdicts: Emma names each story in a few words, Synthesizer answers with one word; she overrules him once.',
        'Ein-Wort-Urteile: Emma nennt jede Geschichte in wenigen Worten, Synthesizer antwortet mit einem Wort; einmal überstimmt sie ihn.'),
      o('nobody-talks', 'what nobody is talking about', 'worüber keiner redet',
        'The thing nobody is talking about: each names one detail from today\'s article that deserves more attention.',
        'Worüber keiner redet: Beide nennen ein Detail aus dem heutigen Artikel, das mehr Aufmerksamkeit verdient.'),
      o('settle-up', 'settle up', 'Abrechnung',
        'Settle up: they come back to the bet or the biggest disagreement of the day and decide who was more right, or refuse to.',
        'Abrechnung: Sie kommen auf die Wette oder den größten Streit des Tages zurück und entscheiden, wer mehr recht hatte, oder weigern sich.'),
    ],
  },
  {
    id: 'coarseness',
    pick: 1,
    cooldown: 0,
    options: [
      o('clean', 'clean-ish', 'fast sauber',
        'Clean-ish today: at most one mild swear word in the whole episode.',
        'Heute fast sauber: höchstens ein leichter Fluch in der ganzen Folge.', 1),
      o('salty', 'salty', 'deftig',
        'Salty: three to six swear words where the conviction is real (shit, bullshit, ass, pissed, damn), at most one f-word.',
        'Deftig: drei bis sechs Flüche, wo die Überzeugung echt ist (Scheiße, Bullshit, Arsch, angepisst, verdammt), höchstens ein F-Wort.', 2),
      o('unfiltered', 'unfiltered', 'ungefiltert',
        'Unfiltered: swearing is part of the heat, up to eight swear words, at most three f-words.',
        'Ungefiltert: Fluchen gehört zur Hitze, bis zu acht Flüche, höchstens drei F-Wörter.', 1),
    ],
  },
]

export function axis(id: AxisId): RegieAxis {
  const a = REGIE_AXES.find((x) => x.id === id)
  if (!a) throw new Error(`Unbekannte Regie-Achse: ${id}`)
  return a
}

export function option(axisId: AxisId, optionId: string): RegieOption | undefined {
  return axis(axisId).options.find((x) => x.id === optionId)
}

/** Für alle Flüche gilt dasselbe, egal welche Stufe. */
export const SWEARING_LIMITS = {
  en: 'Never slurs, never aimed at groups or private individuals; swearing is for conviction, not decoration.',
  de: 'Nie Beleidigungen gegen Gruppen oder Privatleute; geflucht wird aus Überzeugung, nicht als Dekoration.',
}
