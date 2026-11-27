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

const inflightIndexSync = new Map<SupportedLang, Promise<StoredGlossaryCache>>()
const detailCache = new Map<string, { expiresAt: number; data: TermDetailResponse }>()

function indexStorageKey(lang: SupportedLang): string {
  return lang === 'de' ? STORAGE_KEYS.INDEX_DE : STORAGE_KEYS.INDEX_EN
}

async function ensureInitialized(): Promise<void> {
  const stored = await ext.storage.sync.get([STORAGE_KEYS.SETTINGS])
  if (!stored[STORAGE_KEYS.SETTINGS]) {
    await ext.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS })
  }

  const existingAlarm = await ext.alarms.get(ALARM_NAME)
  if (!existingAlarm) {
    await ext.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: SYNC_INTERVAL_MINUTES,
    })
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

    const res = await fetch(`${API_BASE}/api/glossary/extension-index?lang=${lang}`, {
      headers,
      cache: 'no-store',
    })

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

  const res = await fetch(`${API_BASE}/api/glossary/term/${encodeURIComponent(slug)}?lang=${lang}`)
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

ext.runtime.onInstalled.addListener(() => {
  void (async () => {
    await ensureInitialized()
    await Promise.allSettled([syncGlossaryIndex('de'), syncGlossaryIndex('en')])
  })()
})

ext.runtime.onStartup.addListener(() => {
  void ensureInitialized()
})

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return
  void Promise.allSettled([syncGlossaryIndex('de'), syncGlossaryIndex('en')])
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
            await Promise.all([syncGlossaryIndex('de', true), syncGlossaryIndex('en', true)])
          }
          const status = await getStatus()
          return { ok: true, data: status }
        }
        case 'GET_TERM_DETAIL': {
          const data = await getTermDetail(msg.slug, msg.lang === 'en' ? 'en' : 'de')
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
