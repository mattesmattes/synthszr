// Mappt den "Repo-Intensität"-Slider (0–100) auf Retrieval-Parameter für das
// Mattes-Korpus (findRelevantMattesPassages). null = kein Korpus-Retrieval.
// Die Menge (limit) ist der primäre Dosis-Regler gegen Überdosierung.
export function repoRetrievalParams(intensity: number): { limit: number; threshold: number } | null {
  const n = Math.min(100, Math.max(0, Math.round(intensity)))
  if (n <= 0) return null
  if (n <= 25) return { limit: 1, threshold: 0.5 }
  if (n <= 50) return { limit: 2, threshold: 0.5 }
  if (n <= 75) return { limit: 3, threshold: 0.5 }
  return { limit: 4, threshold: 0.45 }
}
