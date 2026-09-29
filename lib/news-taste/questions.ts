import type { EvaluateQuestion } from '@/lib/ai/evaluate'

/**
 * Der Fragenkatalog des News-Taste-Modells. Jede Frage wird von Jev je
 * Artikel EINMAL beantwortet (alle in einem Request); die Antworten sind die
 * Eingabe-Features des trainierten Klassifikators.
 *
 * FEATURES_VERSION bei JEDER inhaltlichen Änderung erhöhen: Training und
 * Inferenz müssen denselben Katalog sehen (predict.ts verweigert sonst den
 * Start), und gespeicherte Vektoren alter Versionen dürfen nicht einfließen.
 * Fragen auf Englisch — die Quellartikel sind es überwiegend auch.
 */
export const FEATURES_VERSION = 1

const b = (instructions: string, criteria: { true: string; false: string }): EvaluateQuestion =>
  ({ type: 'boolean', instructions, criteria })

export const STORY_TYPE_OPTIONS = ['launch', 'finance', 'research', 'policy', 'incident', 'opinion', 'meta', 'other'] as const

export const TASTE_QUESTIONS: Record<string, EvaluateQuestion> = {
  concrete_event: b('Does the text report a concrete news event — something that just happened?', {
    true: 'A dated, specific occurrence: an announcement, release, deal, incident, decision.',
    false: 'A tutorial, guide, opinion, evergreen explainer, or roundup without one central event.',
  }),
  product_launch: b('Does it announce a new product, feature, or service being launched or shipped?', {
    true: 'Something new is available or dated for release.',
    false: 'No launch; rumors without substance count as false.',
  }),
  model_release: b('Does it announce a new AI model, model version, or major benchmark result?', {
    true: 'A lab releases or updates a model, or publishes standout benchmark numbers.',
    false: 'AI is only mentioned; no model news.',
  }),
  corporate_move: b('Does it report a strategic company move?', {
    true: 'Acquisition, partnership, restructuring, market entry/exit, major executive change.',
    false: 'No strategic move by a company.',
  }),
  funding_financials: b('Does it report funding, valuation, earnings, or other financial results?', {
    true: 'Concrete money news: a round, IPO, revenue, guidance, valuation.',
    false: 'No financial news.',
  }),
  security_incident: b('Does it report a security incident, breach, exploit, or vulnerability?', {
    true: 'A concrete security event or disclosed vulnerability.',
    false: 'General security advice or nothing security-related.',
  }),
  research_breakthrough: b('Does it report a notable research result or scientific advance?', {
    true: 'A paper, study, or lab result with a substantive finding.',
    false: 'No research news.',
  }),
  regulation_policy: b('Does it report government regulation, policy, lawsuits, or geopolitics affecting tech?', {
    true: 'Laws, rulings, executive action, antitrust, export controls, major litigation.',
    false: 'No policy/legal dimension.',
  }),
  notable_statement: b('Does it center on a noteworthy statement or prediction by an influential tech figure?', {
    true: 'A quote, interview, or post by a well-known executive, researcher, or investor is the story.',
    false: 'No such statement, or it is peripheral.',
  }),
  big_player: b('Is a major AI/tech player central to the story?', {
    true: 'OpenAI, Anthropic, Google, Microsoft, Meta, Nvidia, Apple, Amazon, xAI, DeepSeek, or a comparable giant drives the story.',
    false: 'Only smaller or unnamed companies are central.',
  }),
  ai_core: b('Is artificial intelligence central to the story, not just mentioned?', {
    true: 'The story is about AI models, AI products, AI companies, or AI impact.',
    false: 'AI appears only in passing or not at all.',
  }),
  tutorial_or_guide: b('Is this primarily a tutorial, how-to, roadmap, guide, or listicle?', {
    true: 'Instructional or list-style content meant to teach or enumerate.',
    false: 'It reports news rather than instructing.',
  }),
  opinion_only: b('Is this primarily opinion or commentary without a new fact?', {
    true: 'A take, reflection, or argument with no fresh news in it.',
    false: 'It contains new factual reporting.',
  }),
  promo_or_ad: b('Is this primarily an advertisement, sponsor message, or self-promotion?', {
    true: 'Selling or promoting a product, course, event, or the newsletter itself.',
    false: 'Editorial content.',
  }),
  newsletter_boilerplate: b('Is this a newsletter section header, housekeeping note, or other boilerplate?', {
    true: 'Subscription pitches, table-of-contents fragments, greetings, footers.',
    false: 'A real article or news item.',
  }),
  aggregator_roundup: b('Is this a roundup of many small items rather than one story?', {
    true: 'A list of several unrelated links/briefs.',
    false: 'One coherent story.',
  }),
  business_relevance: b('Would this story matter to a business decision-maker thinking about AI strategy?', {
    true: 'It informs decisions about AI adoption, vendors, market shifts, or competition.',
    false: 'Hobbyist, niche-technical, or irrelevant to business decisions.',
  }),
  novelty: b('Does the story contain genuinely new information?', {
    true: 'A development that was not widely known before.',
    false: 'A rehash, follow-up without substance, or evergreen content.',
  }),
  controversy: b('Does the story involve conflict, drama, or a surprising turn?', {
    true: 'Disputes, backlash, firings, lawsuits, U-turns, rivalry.',
    false: 'Uncontroversial, expected news.',
  }),
  quantified: b('Does the story contain concrete numbers that anchor it?', {
    true: 'Money amounts, user counts, benchmark scores, percentages.',
    false: 'No meaningful numbers.',
  }),
  importance: {
    type: 'score',
    instructions: 'Rate how important this story is for a daily tech/AI/business newsletter aimed at decision-makers.',
    criteria: [
      'trivial: a niche note few readers would miss',
      'minor: worth a one-liner at most',
      'notable: solid candidate for a section',
      'major: one of the day\'s bigger stories',
      'front-page: the day\'s defining tech story',
    ],
  },
  depth: {
    type: 'score',
    instructions: 'Rate how much substance the text itself carries.',
    criteria: [
      'stub: headline with no substance',
      'thin: a short summary with little detail',
      'solid: a full report with context',
      'deep: analysis with data, quotes, or original reporting',
    ],
  },
  story_type: {
    type: 'choice',
    instructions: 'Classify the dominant type of this story.',
    criteria: {
      launch: 'product/model launch or release',
      finance: 'funding, earnings, valuation, markets',
      research: 'research results, papers, science',
      policy: 'regulation, lawsuits, geopolitics',
      incident: 'security incident, outage, failure',
      opinion: 'opinion, commentary, essay',
      meta: 'newsletter housekeeping, ads, boilerplate',
      other: 'none of the above',
    },
  },
}

const BOOLEAN_NAMES = Object.entries(TASTE_QUESTIONS)
  .filter(([, q]) => q.type === 'boolean')
  .map(([name]) => name)

export const JEV_FEATURE_NAMES: string[] = [
  ...BOOLEAN_NAMES,
  'importance', 'importance_spread',
  'depth', 'depth_spread',
  ...STORY_TYPE_OPTIONS.map((o) => `story_${o}`),
]

export const EXTRA_FEATURE_NAMES: string[] = [
  'synthesis_score', 'relevance_score', 'uniqueness_score',
  'source_bonus', 'source_pub_rate', 'log_content_length',
]

export const FEATURE_NAMES: string[] = [...JEV_FEATURE_NAMES, ...EXTRA_FEATURE_NAMES]
