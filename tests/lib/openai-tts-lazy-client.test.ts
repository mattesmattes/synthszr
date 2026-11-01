/**
 * Der OpenAI-Client in lib/tts/openai-tts.ts darf beim Import nicht entstehen:
 * `new OpenAI()` wirft ohne OPENAI_API_KEY, und Next lädt das Modul im Build.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const saved = process.env.OPENAI_API_KEY

afterEach(() => {
  if (saved === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = saved
  vi.resetModules()
})

describe('openai-tts', () => {
  it('laesst sich ohne OPENAI_API_KEY importieren', async () => {
    delete process.env.OPENAI_API_KEY
    vi.resetModules()
    await expect(import('@/lib/tts/openai-tts')).resolves.toBeDefined()
  })
})
