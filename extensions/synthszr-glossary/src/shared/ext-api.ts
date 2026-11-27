/// <reference path="../chrome.d.ts" />

export type AsyncMessageHandler = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => Promise<unknown> | undefined

interface GlobalWithExt {
  browser?: typeof chrome
  chrome?: typeof chrome
}

/**
 * Returns true when running under the standard Promise-based `browser.*` namespace
 * (Safari Web Extensions, Firefox).
 */
export function isBrowserNamespace(): boolean {
  const g = globalThis as unknown as GlobalWithExt
  return (
    typeof g.browser !== 'undefined' &&
    typeof g.browser.runtime !== 'undefined' &&
    typeof g.browser.storage !== 'undefined'
  )
}

/**
 * Cross-browser WebExtension API accessor.
 * Prefers native `browser.*` (Safari / Firefox) and falls back to `chrome.*` (Chromium).
 */
export function getExtensionApi(): typeof chrome {
  const g = globalThis as unknown as GlobalWithExt
  if (isBrowserNamespace() && g.browser) {
    return g.browser
  }
  if (g.chrome) {
    return g.chrome
  }
  throw new Error('No WebExtension API namespace (browser/chrome) found')
}

/**
 * Registers a `runtime.onMessage` handler that works identically on Safari (`browser` Promise return)
 * and Chrome (`sendResponse` + `return true`).
 */
export function addAsyncMessageListener(handler: AsyncMessageHandler): void {
  const api = getExtensionApi()
  if (isBrowserNamespace()) {
    api.runtime.onMessage.addListener((message, sender) => {
      const promise = handler(message, sender)
      return promise ?? false
    })
    return
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const promise = handler(message, sender)
    if (!promise) return false
    void promise.then(sendResponse)
    return true
  })
}
