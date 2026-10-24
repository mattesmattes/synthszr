/**
 * Slug-Stamm der Wochenrückblicke. Eigenes Modul ohne Abhängigkeiten, weil
 * collect.ts (Rückblicke beim Einsammeln überspringen) und build.ts
 * (Slug bilden, Duplikat prüfen) ihn beide brauchen und build.ts collect.ts
 * importiert — Tests mocken collect.ts komplett.
 */
export const WRAPUP_SLUG_PREFIX = 'ai-week-wrap-up-'
