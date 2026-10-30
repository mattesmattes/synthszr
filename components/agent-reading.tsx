import { skillUrl } from '@/lib/agents/discovery'
import { AGENT_SKILL_INSTALL, AGENT_SKILL_REPOSITORY, agentReadingCopy } from '@/lib/agents/reading'
import type { LanguageCode } from '@/lib/types'

/** Server-rendered entry point; native details works without client JavaScript. */
export function AgentReading({ locale, source }: {
  locale: LanguageCode
  source: 'homepage' | 'article'
}) {
  const copy = agentReadingCopy(locale)

  return (
    <section aria-labelledby="agent-reading-title" className="my-8 rounded-lg border border-border bg-secondary/40 p-5 sm:p-6">
      <h2 id="agent-reading-title" className="text-lg font-semibold tracking-tight">{copy.title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.intro}</p>
      <a href={skillUrl(source)} className="mt-3 inline-block text-sm font-medium underline underline-offset-4">
        {copy.skillLabel} →
      </a>
      <details className="mt-4 border-t border-border pt-4 text-sm">
        <summary className="cursor-pointer font-medium">{copy.detailsLabel}</summary>
        <div className="mt-4 space-y-3">
          <p>{copy.installLabel}</p>
          <pre className="whitespace-pre-wrap break-words rounded bg-background p-3 text-xs leading-relaxed"><code>{AGENT_SKILL_INSTALL}</code></pre>
          <a href={AGENT_SKILL_REPOSITORY} className="inline-block underline underline-offset-4">{copy.installHelp} →</a>
          <p className="text-muted-foreground">{copy.manualHelp}</p>
          <h3 className="font-medium">{copy.exampleLabel}</h3>
          <blockquote className="break-words border-l-2 border-foreground/30 pl-4 leading-relaxed">{copy.example}</blockquote>
        </div>
      </details>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{copy.consent}</p>
    </section>
  )
}
