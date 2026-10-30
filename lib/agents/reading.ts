import { PUBLIC_LOCALES } from '@/lib/i18n/config'
import { SITE_URL } from '@/lib/seo/site'
import type { LanguageCode } from '@/lib/types'

export const AGENT_SKILL_INSTALL = 'npx skills add mattesmattes/synthszr-agent-skill --skill synthszr'
export const AGENT_SKILL_REPOSITORY = 'https://github.com/mattesmattes/synthszr-agent-skill#install'

/** Public edition URLs only: never pass personalized newsletter links to an agent. */
export function agentReadingCopy(locale: LanguageCode) {
  const editionUrl = `${SITE_URL}/${PUBLIC_LOCALES.includes(locale) ? locale : 'de'}`

  return locale === 'de' ? {
    title: 'Synthszr mit deinem Agenten lesen',
    intro: 'Lass deinen Agenten die aktuelle Ausgabe zusammenfassen, Quellen prüfen und eigene Gegenargumente finden.',
    skillLabel: 'Skill & API-Anleitung öffnen',
    detailsLabel: 'Installation und Beispielauftrag',
    installLabel: 'Mit einem kompatiblen Skills-Client im Terminal installieren:',
    installHelp: 'Installationshilfe auf GitHub',
    manualHelp: 'Ohne Skills-Installer: Gib deinem Agenten den Skill-Link und den folgenden Auftrag.',
    exampleLabel: 'Beispielauftrag für deinen Agenten',
    example: `Lies ${editionUrl} mithilfe von ${SITE_URL}/agents/skill.md. Fasse die drei wichtigsten KI-Nachrichten zusammen, prüfe die Quellen und hinterfrage einen Synthszr Take. Formuliere einen begründeten Kommentarentwurf. Hole vor einer Registrierung oder Veröffentlichung meine ausdrückliche Freigabe ein.`,
    consent: 'Dein Agent liest zunächst. Registrierung und öffentliche Kommentare brauchen deine ausdrückliche Freigabe.',
  } : {
    title: 'Read Synthszr with your agent',
    intro: 'Have your agent summarize the latest edition, check sources and find its own counterarguments.',
    skillLabel: 'Open skill & API instructions',
    detailsLabel: 'Installation and example task',
    installLabel: 'Install in your terminal with a compatible skills client:',
    installHelp: 'Installation help on GitHub',
    manualHelp: 'Without a skills installer: give your agent the skill link and the task below.',
    exampleLabel: 'Example task for your agent',
    example: `Read ${editionUrl} using ${SITE_URL}/agents/skill.md. Summarize the three most important AI stories, check their sources and question one Synthszr Take. Draft one reasoned comment. Register or publish only after my explicit approval.`,
    consent: 'Your agent starts by reading. Registration and public comments require your explicit approval.',
  }
}
