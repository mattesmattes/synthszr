/**
 * Section-markdown formatting helpers shared by the ghostwriter section writer.
 */

/**
 * Appends the company-tag/source line to the end of the preceding paragraph
 * instead of letting it stand as its own paragraph.
 *
 * The section writer emits the tagging line as a separate markdown paragraph
 * (blank line before it), e.g.
 *
 *   …Opus-Modelle dominieren.
 *
 *   {Anthropic} {OpenAI} {Ramp} → AI Weekly
 *
 *   Synthszr Take: …
 *
 * which renders the source on its own line. We want it attached to the news
 * summary instead:
 *
 *   …Opus-Modelle dominieren. {Anthropic} {OpenAI} {Ramp} → AI Weekly
 *
 *   Synthszr Take: …
 *
 * Deterministic: collapse the blank line(s) before a paragraph that STARTS with
 * a `{Company}` tag into a single space. The `{…}` directive is unique to the
 * tagging line, so this never touches the heading or the Synthszr Take. Only the
 * first such occurrence per section is joined (there is exactly one tagging line).
 */
export function joinCompanyTagToSummary(markdown: string): string {
  return markdown.replace(/\n[ \t]*(?:\n[ \t]*)+(\{[^}\n]+\}[^\n]*)/, ' $1')
}
