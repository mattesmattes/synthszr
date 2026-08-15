// lib/currency/currencies.ts
// Welcher Lexikon-Begriff eine Fremdwährung IST — und damit einen Umrechner
// bekommt.
//
// WARUM IM CODE UND NICHT IN DER DATENBANK: ein Feld an `glossary_terms`
// bräuchte eine Migration, und Migrationen laufen in diesem Projekt nur von
// Hand über das Supabase-Dashboard (s. Memory „Supabase-Migrationen nur per
// Dashboard"). Die Menge der Währungen ist klein, ändert sich praktisch nie und
// ist an die EZB-Liste gebunden — eine Konstante ist hier die ehrlichere
// Ablage als eine Spalte, die niemand pflegt.
//
// Abgedeckt sind ausschließlich die 29 Währungen, für die die EZB einen
// Referenzkurs veröffentlicht. Ein Begriff zu einer anderen Währung bekäme
// keinen Rechner — bewusst: lieber keiner als einer mit geratenem Kurs.

export interface WaehrungsInfo {
  /** ISO-4217-Code, wie ihn die EZB-Datei führt. */
  code: string
  /** Anzeigename in der Oberfläche. */
  name: { de: string; en: string }
  /** Land/Raum, für die Zeile unter dem Rechner. */
  raum: { de: string; en: string }
}

export const WAEHRUNGEN: Record<string, WaehrungsInfo> = {
  USD: { code: 'USD', name: { de: 'US-Dollar', en: 'US dollar' }, raum: { de: 'USA', en: 'United States' } },
  JPY: { code: 'JPY', name: { de: 'Yen', en: 'Japanese yen' }, raum: { de: 'Japan', en: 'Japan' } },
  CZK: { code: 'CZK', name: { de: 'Tschechische Krone', en: 'Czech koruna' }, raum: { de: 'Tschechien', en: 'Czechia' } },
  DKK: { code: 'DKK', name: { de: 'Dänische Krone', en: 'Danish krone' }, raum: { de: 'Dänemark', en: 'Denmark' } },
  GBP: { code: 'GBP', name: { de: 'Britisches Pfund', en: 'Pound sterling' }, raum: { de: 'Vereinigtes Königreich', en: 'United Kingdom' } },
  HUF: { code: 'HUF', name: { de: 'Forint', en: 'Hungarian forint' }, raum: { de: 'Ungarn', en: 'Hungary' } },
  PLN: { code: 'PLN', name: { de: 'Złoty', en: 'Polish złoty' }, raum: { de: 'Polen', en: 'Poland' } },
  RON: { code: 'RON', name: { de: 'Rumänischer Leu', en: 'Romanian leu' }, raum: { de: 'Rumänien', en: 'Romania' } },
  SEK: { code: 'SEK', name: { de: 'Schwedische Krone', en: 'Swedish krona' }, raum: { de: 'Schweden', en: 'Sweden' } },
  CHF: { code: 'CHF', name: { de: 'Schweizer Franken', en: 'Swiss franc' }, raum: { de: 'Schweiz', en: 'Switzerland' } },
  ISK: { code: 'ISK', name: { de: 'Isländische Krone', en: 'Icelandic króna' }, raum: { de: 'Island', en: 'Iceland' } },
  NOK: { code: 'NOK', name: { de: 'Norwegische Krone', en: 'Norwegian krone' }, raum: { de: 'Norwegen', en: 'Norway' } },
  TRY: { code: 'TRY', name: { de: 'Türkische Lira', en: 'Turkish lira' }, raum: { de: 'Türkei', en: 'Türkiye' } },
  AUD: { code: 'AUD', name: { de: 'Australischer Dollar', en: 'Australian dollar' }, raum: { de: 'Australien', en: 'Australia' } },
  BRL: { code: 'BRL', name: { de: 'Real', en: 'Brazilian real' }, raum: { de: 'Brasilien', en: 'Brazil' } },
  CAD: { code: 'CAD', name: { de: 'Kanadischer Dollar', en: 'Canadian dollar' }, raum: { de: 'Kanada', en: 'Canada' } },
  CNY: { code: 'CNY', name: { de: 'Renminbi', en: 'Renminbi' }, raum: { de: 'China', en: 'China' } },
  HKD: { code: 'HKD', name: { de: 'Hongkong-Dollar', en: 'Hong Kong dollar' }, raum: { de: 'Hongkong', en: 'Hong Kong' } },
  IDR: { code: 'IDR', name: { de: 'Rupiah', en: 'Indonesian rupiah' }, raum: { de: 'Indonesien', en: 'Indonesia' } },
  ILS: { code: 'ILS', name: { de: 'Schekel', en: 'Israeli shekel' }, raum: { de: 'Israel', en: 'Israel' } },
  INR: { code: 'INR', name: { de: 'Indische Rupie', en: 'Indian rupee' }, raum: { de: 'Indien', en: 'India' } },
  KRW: { code: 'KRW', name: { de: 'Won', en: 'South Korean won' }, raum: { de: 'Südkorea', en: 'South Korea' } },
  MXN: { code: 'MXN', name: { de: 'Mexikanischer Peso', en: 'Mexican peso' }, raum: { de: 'Mexiko', en: 'Mexico' } },
  MYR: { code: 'MYR', name: { de: 'Ringgit', en: 'Malaysian ringgit' }, raum: { de: 'Malaysia', en: 'Malaysia' } },
  NZD: { code: 'NZD', name: { de: 'Neuseeland-Dollar', en: 'New Zealand dollar' }, raum: { de: 'Neuseeland', en: 'New Zealand' } },
  PHP: { code: 'PHP', name: { de: 'Philippinischer Peso', en: 'Philippine peso' }, raum: { de: 'Philippinen', en: 'Philippines' } },
  SGD: { code: 'SGD', name: { de: 'Singapur-Dollar', en: 'Singapore dollar' }, raum: { de: 'Singapur', en: 'Singapore' } },
  THB: { code: 'THB', name: { de: 'Baht', en: 'Thai baht' }, raum: { de: 'Thailand', en: 'Thailand' } },
  ZAR: { code: 'ZAR', name: { de: 'Rand', en: 'South African rand' }, raum: { de: 'Südafrika', en: 'South Africa' } },
}

/**
 * Lexikon-Slug → Währungscode.
 *
 * Mehrere Slugs pro Währung sind Absicht und kein Versehen: dieselbe Währung
 * trägt je nach Zusammenhang verschiedene Namen, und welchen davon das Lexikon
 * als eigenen Begriff führt, entscheidet die Begriffs-Pipeline, nicht diese
 * Datei. Beim Renminbi sind es gleich drei gängige — „Renminbi" ist der Name
 * der Währung, „Yuan" ihre Zähleinheit, „RMB" die Abkürzung.
 *
 * Die Schlüssel müssen dem Slug des Lexikonbegriffs entsprechen, nicht seinem
 * Anzeigenamen.
 */
export const WAEHRUNG_JE_SLUG: Record<string, string> = {
  rmb: 'CNY',
  renminbi: 'CNY',
  yuan: 'CNY',
  'chinesischer-yuan': 'CNY',
  'us-dollar': 'USD',
  dollar: 'USD',
  yen: 'JPY',
  'japanischer-yen': 'JPY',
  'britisches-pfund': 'GBP',
  pfund_sterling: 'GBP',
  'schweizer-franken': 'CHF',
  won: 'KRW',
  'suedkoreanischer-won': 'KRW',
  'indische-rupie': 'INR',
  'neuer-taiwan-dollar': 'TWD', // absichtlich ohne EZB-Kurs — s. Hinweis unten
  'taiwan-dollar': 'TWD',
}

/**
 * Gibt die Währung zu einem Lexikon-Slug zurück, aber NUR wenn die EZB dafür
 * einen Referenzkurs führt. Der Neue Taiwan-Dollar steht bewusst in der
 * Zuordnung oben und fällt hier heraus: taucht er später im Lexikon auf, ist
 * die Absicht dokumentiert, und der Rechner erscheint trotzdem nicht, solange
 * kein belastbarer Kurs vorliegt.
 */
export function waehrungFuerSlug(slug: string): WaehrungsInfo | null {
  const code = WAEHRUNG_JE_SLUG[slug]
  if (!code) return null
  return WAEHRUNGEN[code] ?? null
}
