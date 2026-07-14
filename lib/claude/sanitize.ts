/**
 * Text-Sanitizer für Anthropic-Prompt-Bodies.
 *
 * `String.prototype.slice(0, N)` zählt UTF-16-Code-Units, nicht Codepoints.
 * Liegt die Grenze mitten in einem Surrogate-Paar (z. B. einem Emoji), bleibt
 * ein "lone surrogate" zurück. Der ist in UTF-16 nicht well-formed und lässt
 * Anthropics JSON-Parser den Request-Body mit `400 "no low surrogate in string"`
 * ablehnen. Jeder aus DB-Content geschnittene Prompt-Teil muss daher durch
 * diese Funktion, bevor er in einen API-Call geht.
 */

// High-Surrogate ohne folgendes Low-Surrogate  ODER  Low-Surrogate ohne
// vorangehendes High-Surrogate → jeweils ein einzelnes, verwaistes Surrogate.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function stripLoneSurrogates(text: string): string {
  return text.replace(LONE_SURROGATE, '')
}
