import { addAsyncMessageListener, getExtensionApi } from '../shared/ext-api'
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type BackgroundRequest,
  type BackgroundResponse,
  type ExtensionStatus,
  type StoredGlossaryCache,
  type SupportedLang,
  type TermDetailResponse,
} from '../shared/types'

const ext = getExtensionApi()
const API_BASE = 'https://www.synthszr.com'
const ALARM_NAME = 'synthszr-glossary-sync'
const SYNC_INTERVAL_MINUTES = 360 // 6 hours
const DETAIL_CACHE_TTL_MS = 15 * 60 * 1000
const DETAIL_CACHE_MAX = 120
const ILLUSTRATION_CACHE_TTL_MS = 30 * 60 * 1000
const ILLUSTRATION_CACHE_MAX = 60

const inflightIndexSync = new Map<SupportedLang, Promise<StoredGlossaryCache>>()
const detailCache = new Map<string, { expiresAt: number; data: TermDetailResponse }>()
const illustrationCache = new Map<string, { expiresAt: number; base64: string }>()

function indexStorageKey(lang: SupportedLang): string {
  return lang === 'de' ? STORAGE_KEYS.INDEX_DE : STORAGE_KEYS.INDEX_EN
}

function getPreferredInitialLang(): SupportedLang {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de')) {
    return 'de'
  }
  return 'en'
}

async function getCachedLanguages(): Promise<SupportedLang[]> {
  const stored = await ext.storage.local
    .get<Record<string, StoredGlossaryCache>>([STORAGE_KEYS.INDEX_DE, STORAGE_KEYS.INDEX_EN])
    .catch(() => ({}) as Record<string, StoredGlossaryCache>)
  const langs: SupportedLang[] = []
  if (stored[STORAGE_KEYS.INDEX_DE]?.items?.length) langs.push('de')
  if (stored[STORAGE_KEYS.INDEX_EN]?.items?.length) langs.push('en')
  return langs
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function ensureInitialized(): Promise<void> {
  const syncStorage = ext.storage.sync ?? ext.storage.local
  const stored = await syncStorage.get([STORAGE_KEYS.SETTINGS]).catch(() => ({} as Record<string, unknown>))
  if (!stored[STORAGE_KEYS.SETTINGS]) {
    await syncStorage.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS }).catch(() => undefined)
  }

  if (ext.alarms?.get && ext.alarms?.create) {
    const existingAlarm = await ext.alarms.get(ALARM_NAME).catch(() => undefined)
    if (!existingAlarm) {
      await Promise.resolve(
        ext.alarms.create(ALARM_NAME, {
          delayInMinutes: 1,
          periodInMinutes: SYNC_INTERVAL_MINUTES,
        }),
      ).catch(() => undefined)
    }
  }
}

async function saveGlossaryCache(
  key: string,
  lang: SupportedLang,
  nextCache: StoredGlossaryCache,
): Promise<void> {
  try {
    await ext.storage.local.set({
      [key]: nextCache,
      [STORAGE_KEYS.LAST_SYNC_ERROR]: null,
    })
  } catch (storageErr) {
    // Evict opposite language index if Safari/iOS storage quota is tight, then retry once
    const otherKey = lang === 'de' ? STORAGE_KEYS.INDEX_EN : STORAGE_KEYS.INDEX_DE
    await ext.storage.local.remove(otherKey).catch(() => undefined)
    try {
      await ext.storage.local.set({
        [key]: nextCache,
        [STORAGE_KEYS.LAST_SYNC_ERROR]: null,
      })
    } catch {
      throw storageErr
    }
  }
}

async function syncGlossaryIndex(
  lang: SupportedLang,
  forceRefresh = false,
): Promise<StoredGlossaryCache> {
  const pending = inflightIndexSync.get(lang)
  if (pending) return pending

  const task = (async () => {
    const key = indexStorageKey(lang)
    const stored = await ext.storage.local.get<Record<string, StoredGlossaryCache>>([key])
    const cached = stored[key]

    const headers: Record<string, string> = {}
    if (cached?.version && !forceRefresh) {
      headers['If-None-Match'] = `"${cached.version}"`
    }

    const res = await fetchWithTimeout(`${API_BASE}/api/glossary/extension-index?lang=${lang}`, {
      headers,
      cache: 'no-store',
    }, 15000)

    if (res.status === 304 && cached) {
      const refreshed: StoredGlossaryCache = { ...cached, fetchedAt: Date.now() }
      await saveGlossaryCache(key, lang, refreshed)
      return refreshed
    }

    if (!res.ok) {
      if (cached) {
        await ext.storage.local.set({
          [STORAGE_KEYS.LAST_SYNC_ERROR]: `HTTP ${res.status} (${lang})`,
        })
        return cached
      }
      throw new Error(`Glossary sync failed: HTTP ${res.status}`)
    }

    const payload = (await res.json()) as {
      version: string
      lang: SupportedLang
      count: number
      generatedAt: string
      items: StoredGlossaryCache['items']
    }

    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      if (cached) return cached
      throw new Error('Empty glossary index received')
    }

    const nextCache: StoredGlossaryCache = {
      version: payload.version,
      lang: payload.lang,
      count: payload.count,
      generatedAt: payload.generatedAt,
      fetchedAt: Date.now(),
      items: payload.items,
    }

    await saveGlossaryCache(key, lang, nextCache)

    return nextCache
  })()

  inflightIndexSync.set(lang, task)
  try {
    return await task
  } finally {
    inflightIndexSync.delete(lang)
  }
}

async function getGlossaryIndex(lang: SupportedLang): Promise<StoredGlossaryCache> {
  const key = indexStorageKey(lang)
  const stored = await ext.storage.local.get<Record<string, StoredGlossaryCache>>([key])
  const cached = stored[key]

  if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
    const ageMs = Date.now() - (cached.fetchedAt ?? 0)
    if (ageMs > SYNC_INTERVAL_MINUTES * 60 * 1000) {
      void syncGlossaryIndex(lang).catch(() => undefined)
    }
    return cached
  }

  return syncGlossaryIndex(lang)
}

async function getTermDetail(slug: string, lang: SupportedLang): Promise<TermDetailResponse> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    throw new Error('Invalid glossary slug')
  }

  const cacheKey = `${lang}:${slug}`
  const hit = detailCache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data
  }

  const res = await fetchWithTimeout(
    `${API_BASE}/api/glossary/term/${encodeURIComponent(slug)}?lang=${lang}`,
  )
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = (await res.json()) as TermDetailResponse
  if (detailCache.size >= DETAIL_CACHE_MAX) {
    const oldestKey = detailCache.keys().next().value
    if (oldestKey) detailCache.delete(oldestKey)
  }
  detailCache.set(cacheKey, { expiresAt: Date.now() + DETAIL_CACHE_TTL_MS, data })
  return data
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

async function getTermIllustration(slug: string): Promise<{ base64: string }> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) {
    throw new Error('Invalid glossary slug')
  }

  const hit = illustrationCache.get(slug)
  if (hit && hit.expiresAt > Date.now()) {
    return { base64: hit.base64 }
  }

  const res = await fetchWithTimeout(
    `${API_BASE}/api/glossary/term/${encodeURIComponent(slug)}/illustration`,
  )
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const base64 = arrayBufferToBase64(await res.arrayBuffer())
  if (illustrationCache.size >= ILLUSTRATION_CACHE_MAX) {
    const oldestKey = illustrationCache.keys().next().value
    if (oldestKey) illustrationCache.delete(oldestKey)
  }
  illustrationCache.set(slug, {
    expiresAt: Date.now() + ILLUSTRATION_CACHE_TTL_MS,
    base64,
  })
  return { base64 }
}

async function getStatus(): Promise<ExtensionStatus> {
  const stored = await ext.storage.local.get<Record<string, unknown>>([
    STORAGE_KEYS.INDEX_DE,
    STORAGE_KEYS.INDEX_EN,
    STORAGE_KEYS.LAST_SYNC_ERROR,
  ])

  const de = stored[STORAGE_KEYS.INDEX_DE] as StoredGlossaryCache | undefined
  const en = stored[STORAGE_KEYS.INDEX_EN] as StoredGlossaryCache | undefined
  const lastError = (stored[STORAGE_KEYS.LAST_SYNC_ERROR] as string | null) ?? null

  return {
    de: de ? { count: de.count, version: de.version, fetchedAt: de.fetchedAt } : null,
    en: en ? { count: en.count, version: en.version, fetchedAt: en.fetchedAt } : null,
    lastError,
  }
}

ext.runtime.onInstalled?.addListener(() => {
  void (async () => {
    await ensureInitialized()
    await syncGlossaryIndex(getPreferredInitialLang()).catch(() => undefined)
  })()
})

ext.runtime.onStartup?.addListener(() => {
  void ensureInitialized()
})

ext.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return
  void (async () => {
    const cached = await getCachedLanguages()
    const targets = cached.length > 0 ? cached : [getPreferredInitialLang()]
    await Promise.allSettled(targets.map((lang) => syncGlossaryIndex(lang)))
  })()
})

addAsyncMessageListener((rawMessage, sender): Promise<BackgroundResponse> | undefined => {
  const msg = rawMessage as BackgroundRequest | undefined
  if (!msg || typeof msg.type !== 'string') return undefined

  return (async (): Promise<BackgroundResponse> => {
    try {
      switch (msg.type) {
        case 'GET_GLOSSARY_INDEX': {
          const data = await getGlossaryIndex(msg.lang === 'en' ? 'en' : 'de')
          return { ok: true, data }
        }
        case 'ENSURE_GLOSSARY_INDEX': {
          const data = await getGlossaryIndex(msg.lang === 'en' ? 'en' : 'de')
          return { ok: true, data: { version: data.version, count: data.count } }
        }
        case 'REPORT_PAGE_STATE': {
          const tabId = sender.tab?.id
          if (tabId !== undefined && ext.action?.setBadgeText) {
            try {
              if (msg.paused) {
                await ext.action.setBadgeText({ tabId, text: 'OFF' })
                await ext.action.setBadgeBackgroundColor?.({ tabId, color: '#71717a' })
                await ext.action.setBadgeTextColor?.({ tabId, color: '#ffffff' })
              } else if (msg.count > 0) {
                const label = msg.count > 99 ? '99+' : String(msg.count)
                await ext.action.setBadgeText({ tabId, text: label })
                await ext.action.setBadgeBackgroundColor?.({ tabId, color: '#ccff00' })
                await ext.action.setBadgeTextColor?.({ tabId, color: '#111111' })
              } else {
                await ext.action.setBadgeText({ tabId, text: '' })
              }
            } catch {
              // Ignore badge errors on browsers without full action badge styling support
            }
          }
          return { ok: true, data: null }
        }
        case 'SYNC_NOW': {
          if (msg.lang) {
            await syncGlossaryIndex(msg.lang, true)
          } else {
            const cached = await getCachedLanguages()
            const targets = cached.length > 0 ? cached : [getPreferredInitialLang()]
            await Promise.all(targets.map((lang) => syncGlossaryIndex(lang, true)))
          }
          const status = await getStatus()
          return { ok: true, data: status }
        }
        case 'GET_TERM_DETAIL': {
          const data = await getTermDetail(msg.slug, msg.lang === 'en' ? 'en' : 'de')
          return { ok: true, data }
        }
        case 'GET_TERM_ILLUSTRATION': {
          const data = await getTermIllustration(msg.slug)
          return { ok: true, data }
        }
        case 'GET_STATUS': {
          const status = await getStatus()
          return { ok: true, data: status }
        }
        case 'OPEN_URL': {
          if (
            typeof msg.url === 'string' &&
            (msg.url.startsWith('https://www.synthszr.com/') ||
              msg.url.startsWith('https://synthszr.vercel.app/'))
          ) {
            await ext.tabs.create({ url: msg.url })
          }
          return { ok: true, data: null }
        }
        default:
          return { ok: false, error: 'Unsupported message type' }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown background error'
      await ext.storage.local.set({ [STORAGE_KEYS.LAST_SYNC_ERROR]: errorMsg }).catch(() => undefined)
      return { ok: false, error: errorMsg }
    }
  })()
})
