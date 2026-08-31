/**
 * Anti-LLM-Stilregeln fuer den Enrich-Prozess — Kernregeln aus dem
 * Mattes-Schreibe-Skill (.claude/commands/mattes-schreibe.md /
 * scripts/mattes-schreibe-SKILL.md), hier als Code-Konstante dupliziert:
 * der Skill ist fuer interaktive Claude-Code-Nutzung gedacht und aus einer
 * Vercel-Function heraus nicht zuverlaessig von der Platte lesbar. Bei
 * Aenderungen am Skill auch hier nachziehen (Betreiber-Vorgabe 2026-08-31,
 * nachdem enrichte Abschnitte deutlich nach Gedankenstrich-lastigem
 * KI-Text klangen).
 */
export const ANTI_LLM_STYLE_RULES = `STIL (verbindlich, Mattes-Schreibe-Regeln):
- KEINE Gedankenstriche (— oder –) als Satzteiler. Ersetze durch Komma, Punkt, Doppelpunkt, Semikolon oder Klammer.
- KEINE "Nicht X, sondern Y"-Konstruktionen in jeder Form ("Das ist nicht X. Das ist Y.", "Vergiss X. Das ist Y.", "Weniger X, mehr Y."). Formuliere die Aussage direkt positiv, ohne vorherige Negation.
- KEINE toten Übergänge: "darüber hinaus", "zusätzlich", "außerdem" (wenn mechanisch), "es ist wichtig zu beachten, dass", "es ist erwähnenswert", "in der heutigen [Thema]-Welt", "anders gesagt", "es versteht sich von selbst".
- KEINE leeren Business-Floskeln: "nutzen/einsetzen" als Füllwort, "Umfeld/Sphäre/robust" im Marketing-Sinn, "Gamechanger/bahnbrechend/unkompliziert".
- Konkret statt abstrakt: Zahlen, Namen, greifbare Details statt allgemeiner Behauptungen.
- Satzlänge variieren: kurze, harte Sätze, dann gelegentlich längere. Nie drei lange Sätze hintereinander.
- Vor dem Abschicken pruefen: Klingt das wie ein Sprachmodell, das einen Prompt abarbeitet, oder wie ein Mensch, der es sich vorher gedacht hat? Im Zweifel nochmal umformulieren.`
