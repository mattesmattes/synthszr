import {
  NEGATION_REFRAME_PATTERNS,
  EM_DASH_REPLACEMENT,
  DEAD_TRANSITIONS,
  DEAD_AI_PHRASES,
  BUSINESS_FLUFF,
  WER_ENDING_DESCRIPTION,
} from '@/lib/claude/anti-llm-patterns'

/**
 * Anti-LLM-Stilregeln fuer den Enrich-Prozess — Kernregeln aus dem
 * Mattes-Schreibe-Skill (.claude/commands/mattes-schreibe.md /
 * scripts/mattes-schreibe-SKILL.md), hier als Code-Konstante dupliziert:
 * der Skill ist fuer interaktive Claude-Code-Nutzung gedacht und aus einer
 * Vercel-Function heraus nicht zuverlaessig von der Platte lesbar. Bei
 * Aenderungen am Skill auch hier nachziehen (Betreiber-Vorgabe 2026-08-31,
 * nachdem enrichte Abschnitte deutlich nach Gedankenstrich-lastigem
 * KI-Text klangen).
 *
 * Die konkreten Beispiel-Muster (Negations-Reframe, Em-Dash-Ersatz, tote
 * Uebergaenge/Floskeln) kommen seit 2026-09-01 aus lib/claude/anti-llm-
 * patterns.ts — derselbe Katalog wie SECTION_SYSTEM_PROMPT und
 * PROOFREADING_PROMPT (ghostwriter-pipeline.ts), damit ein neues Muster nur
 * an EINER Stelle ergaenzt werden muss statt an drei auseinanderdriftenden
 * Kopien. Die "Wer …"-Schlussfigur-Regel war bisher NUR in der Generierung
 * und im Proofreading verankert, nicht in Enrich — ergaenzt, weil Enrich den
 * Take aktiv umschreibt und die Figur dabei neu einfuehren koennte.
 */
export const ANTI_LLM_STYLE_RULES = `STIL (verbindlich, Mattes-Schreibe-Regeln):
- KEINE Gedankenstriche (— oder –) als Satzteiler. Ersetze durch ${EM_DASH_REPLACEMENT}.
- KEINE "Nicht X, sondern Y"-Konstruktionen in jeder Form (${NEGATION_REFRAME_PATTERNS.map((p) => `"${p}"`).join(', ')}). Formuliere die Aussage direkt positiv, ohne vorherige Negation.
- KEINE toten Übergänge: ${DEAD_TRANSITIONS.map((t) => `"${t}"`).join(', ')}.
- KEINE leeren Business-Floskeln: ${BUSINESS_FLUFF.join(', ')}.
- KEINE tote KI-Sprache: ${DEAD_AI_PHRASES.map((p) => `"${p}"`).join(', ')}.
- KEINE "Wer …"-Schlussfigur im Synthszr Take: ${WER_ENDING_DESCRIPTION}
- Konkret statt abstrakt: Zahlen, Namen, greifbare Details statt allgemeiner Behauptungen.
- Satzlänge variieren: kurze, harte Sätze, dann gelegentlich längere. Nie drei lange Sätze hintereinander.
- Vor dem Abschicken pruefen: Klingt das wie ein Sprachmodell, das einen Prompt abarbeitet, oder wie ein Mensch, der es sich vorher gedacht hat? Im Zweifel nochmal umformulieren.`
