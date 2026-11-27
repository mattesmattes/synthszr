import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addAsyncMessageListener,
  getExtensionApi,
  isBrowserNamespace,
} from '../../extensions/synthszr-glossary/src/shared/ext-api'

type AnyRecord = Record<string, unknown>

describe('Cross-browser WebExtension API bridge (Safari & Chrome)', () => {
  const g = globalThis as unknown as AnyRecord
  const origBrowser = g.browser
  const origChrome = g.chrome

  afterEach(() => {
    if (origBrowser === undefined) delete g.browser
    else g.browser = origBrowser

    if (origChrome === undefined) delete g.chrome
    else g.chrome = origChrome
  })

  it('prefers browser.* on Safari and returns a Promise directly from onMessage', async () => {
    let registeredListener: ((msg: unknown, sender: unknown) => unknown) | null = null
    const mockBrowser = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => {
            registeredListener = cb
          }),
        },
      },
      storage: { local: {}, sync: {} },
    }
    g.browser = mockBrowser
    g.chrome = { runtime: { onMessage: { addListener: vi.fn() } }, storage: {} }

    expect(isBrowserNamespace()).toBe(true)
    expect(getExtensionApi()).toBe(mockBrowser)

    addAsyncMessageListener((msg) => {
      if ((msg as { type?: string })?.type !== 'PING') return undefined
      return Promise.resolve({ ok: true, engine: 'safari' })
    })

    expect(registeredListener).toBeTypeOf('function')
    expect(registeredListener!({ type: 'OTHER' }, {})).toBe(false)
    await expect(registeredListener!({ type: 'PING' }, {})).resolves.toEqual({
      ok: true,
      engine: 'safari',
    })
  })

  it('falls back to chrome.* on Chromium and resolves via sendResponse + return true', async () => {
    delete g.browser
    let registeredListener: ((msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => unknown) | null = null
    const mockChrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((cb) => {
            registeredListener = cb
          }),
        },
      },
      storage: { local: {}, sync: {} },
    }
    g.chrome = mockChrome

    expect(isBrowserNamespace()).toBe(false)
    expect(getExtensionApi()).toBe(mockChrome)

    addAsyncMessageListener((msg) => {
      if ((msg as { type?: string })?.type !== 'PING') return undefined
      return Promise.resolve({ ok: true, engine: 'chrome' })
    })

    const sendResponse = vi.fn()
    expect(registeredListener!({ type: 'IGNORED' }, {}, sendResponse)).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()

    const keepOpen = registeredListener!({ type: 'PING' }, {}, sendResponse)
    expect(keepOpen).toBe(true)
    await Promise.resolve()
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, engine: 'chrome' })
  })
})
