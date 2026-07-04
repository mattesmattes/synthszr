/**
 * UI-Labels der Produktseiten-Analyse-Blöcke (Stock-Synthszr + Premarket).
 * Die Analyse existiert de/en; nicht-DE Locales bekommen Englisch — analog zur
 * Beschreibungs-Logik in product-detail.ts (`locale === 'de' ? descDe : descEn`).
 */
export function analysisLabels(locale: string) {
  const de = locale === 'de'
  return {
    de,
    dateLocale: de ? 'de-DE' : 'en-GB',
    heading: de ? 'Unternehmens-Analyse' : 'Company Analysis',
    asOf: de ? 'Stand' : 'As of',
    updating: de ? 'wird aktualisiert …' : 'updating …',
    generating: de ? 'wird erstellt …' : 'generating …',
    summary: de ? 'Zusammenfassung' : 'Summary',
    actionIdeas: de ? 'Action-Ideen' : 'Action Ideas',
    horizon: de ? 'Horizont' : 'Horizon',
    months: de ? 'Mon.' : 'mo.',
    sources: de ? 'Quellen' : 'Sources',
    trend: {
      RISING: de ? '↗ steigend' : '↗ rising',
      STABLE: de ? '→ stabil' : '→ stable',
      DECLINING: de ? '↘ fallend' : '↘ declining',
    } as Record<string, string>,
  }
}
