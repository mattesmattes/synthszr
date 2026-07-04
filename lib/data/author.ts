/** Herausgeber/Editor von Synthszr — E-E-A-T-Fundament für Autoren-Attribution
 *  in Article-Schema, sichtbarer Byline und der Autorenseite. Bio faktisch,
 *  von Matthias redigierbar. Übersetzungen via Sonnet (2026-07-04). */
export const AUTHOR = {
  slug: 'mattes-schrader',
  name: 'Matthias Schrader',
  linkedin: 'https://www.linkedin.com/in/mattes/',
  knowsAbout: ['Künstliche Intelligenz', 'Digitale Transformation', 'Business', 'Design', 'Technologie'],
  i18n: {
    de: {
      jobTitle: 'Herausgeber',
      bio: [
        'Matthias Schrader ist Herausgeber von Synthszr. Synthszr verdichtet die wichtigsten KI-Meldungen aus tausenden News- und Newsletter-Quellen zu einer täglichen Synthese an der Schnittstelle von Business, Design und Technologie — ergänzt durch die Synthszr Charts, ein tägliches Momentum-Ranking der relevantesten KI-Produkte.',
        'Er arbeitet im Digital-Agentur-Umfeld und beschäftigt sich seit Jahren mit der Frage, wie Künstliche Intelligenz Wirtschaft, Gestaltung und Technologie verändert. Er ist Autor des Buchs »CODE CRASH«.',
      ],
    },
    en: {
      jobTitle: 'Publisher',
      bio: [
        'Matthias Schrader is the publisher of Synthszr. Synthszr condenses the most important AI news from thousands of news and newsletter sources into a daily synthesis at the intersection of business, design, and technology — complemented by the Synthszr Charts, a daily momentum ranking of the most relevant AI products.',
        'He works in the digital agency environment and has spent years exploring how artificial intelligence is transforming business, design, and technology. He is the author of the book »CODE CRASH«.',
      ],
    },
    cs: {
      jobTitle: 'Vydavatel',
      bio: [
        'Matthias Schrader je vydavatelem Synthszr. Synthszr shrnuje nejdůležitější zprávy o umělé inteligenci z tisíců zpravodajských a newsletterových zdrojů do denní syntézy na pomezí byznysu, designu a technologií — doplněné o Synthszr Charts, denní žebříček momenta nejrelevantnějších AI produktů.',
        'Působí v prostředí digitálních agentur a už řadu let se zabývá otázkou, jak umělá inteligence mění byznys, design a technologie. Je autorem knihy »CODE CRASH«.',
      ],
    },
    nds: {
      jobTitle: 'Rutgever',
      bio: [
        'Matthias Schrader is Rutgever vun Synthszr. Synthszr fasst de wichtigsten KI-Narichten ut Dusende vun News- un Newsletter-Quellen to een dääglich Synthes an de Snittstell vun Business, Design un Technologie tosamen — anvullt dör de Synthszr Charts, een dääglich Momentum-Ranking vun de relevantesten KI-Produkten.',
        'He arbeidt in’t Digital-Agentur-Ümfeld un befaat sik siet Johren mit de Fraag, wodennig Künstliche Intelligenz Wirtschaft, Gestaltung un Technologie verännert. He is Autor vun dat Book »CODE CRASH«.',
      ],
    },
    fr: {
      jobTitle: 'Éditeur',
      bio: [
        'Matthias Schrader est l’éditeur de Synthszr. Synthszr condense les principales actualités sur l’IA issues de milliers de sources d’actualités et de newsletters en une synthèse quotidienne à l’intersection du business, du design et de la technologie — complétée par les Synthszr Charts, un classement quotidien de momentum des produits IA les plus pertinents.',
        'Il évolue dans l’univers des agences digitales et se penche depuis des années sur la question de savoir comment l’intelligence artificielle transforme l’économie, le design et la technologie. Il est l’auteur du livre »CODE CRASH«.',
      ],
    },
  } as Record<string, { jobTitle: string; bio: string[] }>,
}

/** Byline-Label „Herausgegeben von" pro Sprache (sichtbare Autoren-Attribution
 *  unter Artikeln — ehrlich: die Posts sind KI-generiert und redaktionell
 *  kuratiert, daher „herausgegeben von", nicht „geschrieben von"). */
export const EDITED_BY_LABEL: Record<string, string> = {
  de: 'Herausgegeben von',
  en: 'Edited by',
  cs: 'Vydává',
  nds: 'Rutgeven vun',
  fr: 'Édité par',
}

export function authorI18n(locale: string): { jobTitle: string; bio: string[] } {
  return AUTHOR.i18n[locale as keyof typeof AUTHOR.i18n] ?? AUTHOR.i18n.de
}
