/**
 * Wraps each match of `query` inside `text` with a <mark> element so search
 * results show where the term matched. Case-insensitive; the query is
 * regex-escaped before use, since it comes straight from a URL query param
 * (`?q=`) — a bare `.` or `(` in there must not break the match or leak
 * unescaped into the pattern. Falls back to plain text if the query is
 * empty or has no match.
 *
 * No hooks, no 'use client' — a pure function component, usable from both
 * server components (app/[lang]/search/page.tsx) and client components
 * (components/home-search.tsx). Extracted from home-search.tsx (Team-Lead,
 * 2026-08-06) so both search surfaces share one highlighting implementation
 * instead of drifting apart.
 *
 * Highlight color is `#CCFF00` (the project's established highlight/neon
 * accent, e.g. the "Synthszr Take" background), applied via the Tailwind
 * arbitrary-value bracket syntax `bg-[#CCFF00]/60` — NOT the bespoke
 * `bg-neon-cyan`-style class used elsewhere in this file before extraction.
 * That class is hand-written CSS with no Tailwind opacity-modifier support;
 * `bg-neon-cyan/60` compiles to no CSS at all (verified against the built
 * output), so those marks were silently falling back to the browser's
 * native <mark> yellow instead of the intended cyan. The bracket syntax is
 * the pattern already used everywhere else in this codebase for #CCFF00
 * (e.g. components/stock-synthszr-layer.tsx) and does generate real CSS.
 */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  // Escape regex metacharacters in the query
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-[#CCFF00]/60 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
