export interface BatchResult<T> {
  succeeded: number
  failed: Array<{ item: T; error: string }>
}

export interface RunBatchedOptions {
  concurrency?: number
  onProgress?: (done: number, total: number) => void
}

/**
 * Run an async worker over a list of items with bounded concurrency,
 * collecting individual failures without aborting the remaining items.
 */
export async function runBatched<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  options?: RunBatchedOptions,
): Promise<BatchResult<T>> {
  const total = items.length
  if (total === 0) {
    return { succeeded: 0, failed: [] }
  }

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 5, total))
  let nextIndex = 0
  let done = 0
  let succeeded = 0
  const failed: Array<{ item: T; error: string }> = []

  async function runWorker(): Promise<void> {
    while (true) {
      const idx = nextIndex++
      if (idx >= total) return
      const item = items[idx]
      try {
        await worker(item)
        succeeded += 1
      } catch (err) {
        failed.push({
          item,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        done += 1
        options?.onProgress?.(done, total)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))

  return { succeeded, failed }
}
