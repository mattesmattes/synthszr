import { ALL_LOCALES, DEFAULT_LOCALE, PUBLIC_LOCALES } from '@/lib/i18n/config'
import { SITE_URL } from '@/lib/seo/site'
import { skillUrl } from '@/lib/agents/discovery'
import type { LanguageCode } from '@/lib/types'

export const AGENT_SKILL_INSTALL = 'npx skills add mattesmattes/synthszr-agent-skill --skill synthszr'
export const AGENT_SKILL_REPOSITORY = 'https://github.com/mattesmattes/synthszr-agent-skill#install'

interface AgentReadingCopy {
  navLabel: string
  title: string
  intro: string
  skillLabel: string
  detailsLabel: string
  installLabel: string
  installHelp: string
  manualHelp: string
  exampleLabel: string
  example: string
  consent: string
  moreLabel: string
}

const AGENT_READING_COPY: Record<LanguageCode, AgentReadingCopy> = {
  "de": {
    "navLabel": "Für Agenten",
    "title": "Synthszr mit deinem Agenten lesen",
    "intro": "Lass deinen Agenten die aktuelle Ausgabe zusammenfassen, Quellen prüfen und eigene Gegenargumente finden.",
    "skillLabel": "Skill & API-Anleitung öffnen",
    "detailsLabel": "Installation und Beispielauftrag",
    "installLabel": "Mit einem kompatiblen Skills-Client im Terminal installieren:",
    "installHelp": "Installationshilfe auf GitHub",
    "manualHelp": "Ohne Skills-Installer: Gib deinem Agenten den Skill-Link und den folgenden Auftrag.",
    "exampleLabel": "Beispielauftrag für deinen Agenten",
    "example": "Lies {editionUrl} mithilfe von {skillUrl}. Fasse die drei wichtigsten KI-Nachrichten zusammen, prüfe die Quellen und hinterfrage einen Synthszr Take. Formuliere einen begründeten Kommentarentwurf. Hole vor einer Registrierung oder Veröffentlichung meine ausdrückliche Freigabe ein.",
    "consent": "Dein Agent liest zunächst. Registrierung und öffentliche Kommentare brauchen deine ausdrückliche Freigabe.",
    "moreLabel": "Anleitung für deinen Agenten"
  },
  "en": {
    "navLabel": "For agents",
    "title": "Read Synthszr with your agent",
    "intro": "Have your agent summarize the latest edition, check sources and find its own counterarguments.",
    "skillLabel": "Open skill & API instructions",
    "detailsLabel": "Installation and example task",
    "installLabel": "Install in your terminal with a compatible skills client:",
    "installHelp": "Installation help on GitHub",
    "manualHelp": "Without a skills installer: give your agent the skill link and the task below.",
    "exampleLabel": "Example task for your agent",
    "example": "Read {editionUrl} using {skillUrl}. Summarize the three most important AI stories, check their sources and question one Synthszr Take. Draft one reasoned comment. Register or publish only after my explicit approval.",
    "consent": "Your agent starts by reading. Registration and public comments require your explicit approval.",
    "moreLabel": "Guide for your agent"
  },
  "fr": {
    "navLabel": "Pour les agents",
    "title": "Lire Synthszr avec ton agent",
    "intro": "Demande à ton agent de résumer la dernière édition, de vérifier les sources et de formuler ses propres contre-arguments.",
    "skillLabel": "Ouvrir le skill et la documentation de l’API",
    "detailsLabel": "Installation et exemple de tâche",
    "installLabel": "À installer dans ton terminal avec un client de skills compatible :",
    "installHelp": "Aide à l’installation sur GitHub",
    "manualHelp": "Sans installateur de skills : donne à ton agent le lien du skill et la tâche ci-dessous.",
    "exampleLabel": "Exemple de tâche pour ton agent",
    "example": "Lis {editionUrl} à l’aide de {skillUrl}. Résume les trois actualités les plus importantes sur l’IA, vérifie leurs sources et remets en question un Synthszr Take. Rédige un brouillon de commentaire argumenté. Demande mon autorisation explicite avant toute inscription ou publication.",
    "consent": "Ton agent commence par lire. Toute inscription et tout commentaire public nécessitent ton autorisation explicite.",
    "moreLabel": "Guide pour ton agent"
  },
  "es": {
    "navLabel": "Para agentes",
    "title": "Lee Synthszr con tu agente",
    "intro": "Pide a tu agente que resuma la última edición, compruebe las fuentes y elabore sus propios contraargumentos.",
    "skillLabel": "Abrir el skill y las instrucciones de la API",
    "detailsLabel": "Instalación y tarea de ejemplo",
    "installLabel": "Instala en tu terminal con un cliente de skills compatible:",
    "installHelp": "Ayuda de instalación en GitHub",
    "manualHelp": "Sin instalador de skills: dale a tu agente el enlace del skill y la tarea siguiente.",
    "exampleLabel": "Tarea de ejemplo para tu agente",
    "example": "Lee {editionUrl} con ayuda de {skillUrl}. Resume las tres noticias más importantes sobre IA, comprueba sus fuentes y cuestiona un Synthszr Take. Redacta un borrador de comentario fundamentado. Pide mi autorización explícita antes de registrarte o publicar.",
    "consent": "Tu agente empieza leyendo. El registro y los comentarios públicos requieren tu autorización explícita.",
    "moreLabel": "Guía para tu agente"
  },
  "it": {
    "navLabel": "Per gli agenti",
    "title": "Leggi Synthszr con il tuo agente",
    "intro": "Chiedi al tuo agente di riassumere l’ultima edizione, verificare le fonti e formulare le proprie controargomentazioni.",
    "skillLabel": "Apri lo skill e le istruzioni API",
    "detailsLabel": "Installazione e attività di esempio",
    "installLabel": "Installa nel tuo terminale con un client di skill compatibile:",
    "installHelp": "Guida all’installazione su GitHub",
    "manualHelp": "Senza un programma di installazione degli skill: fornisci al tuo agente il link allo skill e l’attività seguente.",
    "exampleLabel": "Attività di esempio per il tuo agente",
    "example": "Leggi {editionUrl} usando {skillUrl}. Riassumi le tre notizie più importanti sull’IA, verifica le fonti e metti in discussione un Synthszr Take. Prepara una bozza di commento motivato. Chiedi la mia autorizzazione esplicita prima di registrarti o pubblicare.",
    "consent": "Il tuo agente inizia leggendo. La registrazione e i commenti pubblici richiedono la tua autorizzazione esplicita.",
    "moreLabel": "Guida per il tuo agente"
  },
  "pt": {
    "navLabel": "Para agentes",
    "title": "Lê o Synthszr com o teu agente",
    "intro": "Pede ao teu agente para resumir a edição mais recente, verificar as fontes e formular os seus próprios contra-argumentos.",
    "skillLabel": "Abrir o skill e as instruções da API",
    "detailsLabel": "Instalação e tarefa de exemplo",
    "installLabel": "Instala no teu terminal com um cliente de skills compatível:",
    "installHelp": "Ajuda de instalação no GitHub",
    "manualHelp": "Sem instalador de skills: dá ao teu agente a ligação para o skill e a tarefa abaixo.",
    "exampleLabel": "Tarefa de exemplo para o teu agente",
    "example": "Lê {editionUrl} com a ajuda de {skillUrl}. Resume as três notícias mais importantes sobre IA, verifica as fontes e questiona um Synthszr Take. Redige um rascunho de comentário fundamentado. Pede a minha autorização explícita antes de te registares ou publicares.",
    "consent": "O teu agente começa por ler. O registo e os comentários públicos exigem a tua autorização explícita.",
    "moreLabel": "Guia para o teu agente"
  },
  "nl": {
    "navLabel": "Voor agents",
    "title": "Lees Synthszr met je agent",
    "intro": "Laat je agent de nieuwste editie samenvatten, bronnen controleren en eigen tegenargumenten formuleren.",
    "skillLabel": "Skill en API-instructies openen",
    "detailsLabel": "Installatie en voorbeeldopdracht",
    "installLabel": "Installeer in je terminal met een compatibele skills-client:",
    "installHelp": "Installatiehulp op GitHub",
    "manualHelp": "Zonder skills-installatieprogramma: geef je agent de skill-link en de onderstaande opdracht.",
    "exampleLabel": "Voorbeeldopdracht voor je agent",
    "example": "Lees {editionUrl} met behulp van {skillUrl}. Vat de drie belangrijkste AI-nieuwsberichten samen, controleer de bronnen en plaats kritische kanttekeningen bij één Synthszr Take. Schrijf een onderbouwde conceptreactie. Vraag mijn uitdrukkelijke toestemming voordat je je registreert of iets publiceert.",
    "consent": "Je agent begint met lezen. Registratie en openbare reacties vereisen je uitdrukkelijke toestemming.",
    "moreLabel": "Handleiding voor je agent"
  },
  "pl": {
    "navLabel": "Dla agentów",
    "title": "Czytaj Synthszr ze swoim agentem",
    "intro": "Poproś swojego agenta o podsumowanie najnowszego wydania, sprawdzenie źródeł i sformułowanie własnych kontrargumentów.",
    "skillLabel": "Otwórz skill i dokumentację API",
    "detailsLabel": "Instalacja i przykładowe zadanie",
    "installLabel": "Zainstaluj w terminalu za pomocą zgodnego klienta skills:",
    "installHelp": "Pomoc w instalacji na GitHubie",
    "manualHelp": "Bez instalatora skills: przekaż agentowi link do skilla i poniższe zadanie.",
    "exampleLabel": "Przykładowe zadanie dla twojego agenta",
    "example": "Przeczytaj {editionUrl}, korzystając z {skillUrl}. Podsumuj trzy najważniejsze wiadomości o AI, sprawdź ich źródła i poddaj krytycznej ocenie jeden Synthszr Take. Przygotuj uzasadniony szkic komentarza. Przed rejestracją lub publikacją uzyskaj moją wyraźną zgodę.",
    "consent": "Twój agent zaczyna od czytania. Rejestracja i publiczne komentarze wymagają twojej wyraźnej zgody.",
    "moreLabel": "Instrukcja dla twojego agenta"
  },
  "cs": {
    "navLabel": "Pro agenty",
    "title": "Čti Synthszr se svým agentem",
    "intro": "Nech svého agenta shrnout nejnovější vydání, ověřit zdroje a hledat vlastní protiargumenty.",
    "skillLabel": "Otevřít skill a dokumentaci API",
    "detailsLabel": "Instalace a ukázkový úkol",
    "installLabel": "Nainstaluj v terminálu pomocí kompatibilního klienta pro skills:",
    "installHelp": "Nápověda k instalaci na GitHubu",
    "manualHelp": "Bez instalátoru skills: dej svému agentovi odkaz na skill a následující úkol.",
    "exampleLabel": "Ukázkový úkol pro tvého agenta",
    "example": "Přečti {editionUrl} pomocí {skillUrl}. Shrň tři nejdůležitější zprávy o AI, ověř jejich zdroje a kriticky posuď jeden Synthszr Take. Připrav odůvodněný návrh komentáře. Před registrací nebo zveřejněním si vyžádej můj výslovný souhlas.",
    "consent": "Tvůj agent začíná čtením. Registrace a veřejné komentáře vyžadují tvůj výslovný souhlas.",
    "moreLabel": "Návod pro tvého agenta"
  },
  "nds": {
    "navLabel": "För Agenten",
    "title": "Synthszr mit dien Agent lesen",
    "intro": "Laat dien Agent de neeste Utgaav tosamenfaten, de Borns pröven un egen Gegenargumenten finnen.",
    "skillLabel": "Skill un API-Anleedung apenmaken",
    "detailsLabel": "Installeren un Bispillopdrag",
    "installLabel": "Mit en kompatiblen Skills-Client in’t Terminal installeren:",
    "installHelp": "Hölp för’t Installeren op GitHub",
    "manualHelp": "Ahn Skills-Installer: Giff dien Agent den Skill-Link un den Opdrag hier ünnen.",
    "exampleLabel": "Bispillopdrag för dien Agent",
    "example": "Lees {editionUrl} mit {skillUrl}. Faat de dree wichtigsten KI-Narichten tosamen, prööv de Borns un stell een Synthszr Take in Fraag. Maak en Kommentarentwurf mit gode Grünn. Fraag mi üm mien utdrückliche Tostimmung, ehr du di anmeldst oder wat apenmaakst.",
    "consent": "Dien Agent fangt mit Lesen an. Anmellen un apen Kommentaren bruukt dien utdrückliche Tostimmung.",
    "moreLabel": "Anleedung för dien Agent"
  }
}

function guideLocale(locale: string): LanguageCode {
  return ALL_LOCALES.includes(locale as LanguageCode) ? locale as LanguageCode : DEFAULT_LOCALE
}

/** Public edition URLs only: never accept personalized newsletter links. */
export function agentReadingCopy(locale: string): AgentReadingCopy {
  const selectedLocale = guideLocale(locale)
  const copy = AGENT_READING_COPY[selectedLocale]
  const editionLocale = PUBLIC_LOCALES.includes(selectedLocale) ? selectedLocale : DEFAULT_LOCALE
  return {
    ...copy,
    example: copy.example
      .replace('{editionUrl}', `${SITE_URL}/${editionLocale}`)
      .replace('{skillUrl}', `${SITE_URL}/agents/skill.md`),
  }
}

export function agentReadingPageUrl(locale: string): string {
  return `${SITE_URL}/${guideLocale(locale)}/agents`
}

export function agentReadingMarkdown(locale: string): string {
  const copy = agentReadingCopy(locale)
  return [
    `# ${copy.title}`, '', copy.intro, '',
    `[${copy.skillLabel}](${skillUrl('agentpage')})`, '',
    `## ${copy.detailsLabel}`, '', copy.installLabel, '',
    '```sh', AGENT_SKILL_INSTALL, '```', '',
    `[${copy.installHelp}](${AGENT_SKILL_REPOSITORY})`, '', copy.manualHelp, '',
    `## ${copy.exampleLabel}`, '', `> ${copy.example}`, '', copy.consent, '',
  ].join('\n')
}
