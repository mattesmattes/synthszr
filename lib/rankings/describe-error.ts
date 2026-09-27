/**
 * Lesbarer Fehlertext für Log und daily_repo.product_processing_error.
 *
 * Supabase liefert Fehler als Objekte ({ message, code, details, hint }), keine
 * Error-Instanzen — resolveProduct wirft sie unverändert weiter. String(err)
 * ergab daraus "[object Object]" (Prod 2026-09-26, Item "YouTube adds AI": drei
 * Versuche, danach aussortiert, der Grund stand nirgends).
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const { message, code, details } = err as { message?: unknown; code?: unknown; details?: unknown }
    if (typeof message === 'string') {
      const extra = [code && `code ${code}`, details].filter((x): x is string => typeof x === 'string' && x !== '')
      return extra.length > 0 ? `${message} (${extra.join('; ')})` : message
    }
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
