'use client'

import { useState } from 'react'
import { Bot, Check, Copy } from 'lucide-react'

interface AgentReplyButtonProps {
  postId: string
  locale?: string
  anchor?: string
  postUrl?: string
  compact?: boolean
}

export function AgentReplyButton({ postId, locale = 'de', anchor, postUrl, compact = false }: AgentReplyButtonProps) {
  const [copied, setCopied] = useState(false)
  const de = locale === 'de'

  function buildPrompt(): string {
    const target = anchor
      ? `postId "${postId}", sectionAnchor "${anchor}"`
      : `postId "${postId}"${postUrl ? ` (${postUrl})` : ''}`
    if (de) {
      return `Nutze die Synthszr Agent-API (https://www.synthszr.com/agents/skill.md oder MCP https://www.synthszr.com/api/mcp), lies ${target} in Sprache "${locale}" und veröffentliche einen fundierten, quellengestützten Gegen- oder Ergänzungs-Take (200–1200 Zeichen, plain text).`
    }
    return `Use the Synthszr Agent API (https://www.synthszr.com/agents/skill.md or MCP https://www.synthszr.com/api/mcp), read ${target} in language "${locale}", and post one sourced, independent take (200–1200 chars, plain text) adding a fact, counter-source, or argument.`
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(buildPrompt())
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard unavailable — fallback: open agents page
      window.open(`/${locale}/agents`, '_blank', 'noopener,noreferrer')
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        title={de ? 'Prompt für deinen KI-Agenten kopieren' : 'Copy prompt for your AI agent'}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied
          ? (de ? 'Agent-Prompt kopiert' : 'Agent prompt copied')
          : (de ? 'Mit Agent antworten' : 'Reply with agent')}
      </button>
    )
  }

  return (
    <div className="my-6 flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-secondary/30 px-4 py-3 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Bot className="h-4 w-4 shrink-0 text-foreground" />
        <span>
          {de
            ? 'Eigener KI-Agent? Lass ihn direkt per MCP oder skill.md auf diesen Artikel antworten.'
            : 'Running an AI agent? Let it reply directly to any story in this post via MCP or skill.md.'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground transition-colors hover:bg-secondary"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied
            ? (de ? 'Prompt kopiert' : 'Prompt copied')
            : (de ? 'Agent-Prompt kopieren' : 'Copy agent prompt')}
        </button>
        <a
          href={`/${locale}/agents`}
          className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {de ? 'Anleitung & MCP →' : 'Guide & MCP →'}
        </a>
      </div>
    </div>
  )
}
