import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type BackgroundResponse,
  type ExtensionSettings,
  type ExtensionStatus,
  type HighlightStyle,
  type LanguageMode,
} from '../shared/types'

const enabledToggle = document.getElementById('enabled-toggle') as HTMLInputElement
const langSelect = document.getElementById('lang-select') as HTMLSelectElement
const styleSelect = document.getElementById('style-select') as HTMLSelectElement
const siteHostEl = document.getElementById('site-host') as HTMLElement
const siteToggleBtn = document.getElementById('site-toggle-btn') as HTMLButtonElement
const syncStatusEl = document.getElementById('sync-status') as HTMLElement
const syncNowBtn = document.getElementById('sync-now-btn') as HTMLButtonElement
const pausedSection = document.getElementById('paused-section') as HTMLElement
const pausedList = document.getElementById('paused-list') as HTMLElement
const glossaryLink = document.getElementById('open-glossary-link') as HTMLAnchorElement

let currentSettings: ExtensionSettings = DEFAULT_SETTINGS
let activeHostname: string | null = null

function isExcluded(hostname: string, list: string[]): boolean {
  const h = hostname.toLowerCase()
  return list.some((d) => {
    const clean = d.trim().toLowerCase()
    return clean.length > 0 && (h === clean || h.endsWith(`.${clean}`))
  })
}

async function saveSettings(next: ExtensionSettings): Promise<void> {
  currentSettings = next
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next })
  renderSettings()
}

function renderSettings(): void {
  enabledToggle.checked = currentSettings.enabled
  langSelect.value = currentSettings.languageMode
  styleSelect.value = currentSettings.highlightStyle

  const linkLang = currentSettings.languageMode === 'en' ? 'en' : 'de'
  glossaryLink.href = `https://www.synthszr.com/${linkLang}/glossary`

  if (activeHostname) {
    siteHostEl.textContent = activeHostname
    const paused = isExcluded(activeHostname, currentSettings.excludedDomains)
    siteToggleBtn.disabled = false
    siteToggleBtn.textContent = paused ? 'Aktivieren' : 'Pausieren'
  } else {
    siteHostEl.textContent = 'Systemseite'
    siteToggleBtn.disabled = true
    siteToggleBtn.textContent = '—'
  }

  pausedList.replaceChildren()
  if (currentSettings.excludedDomains.length === 0) {
    pausedSection.hidden = true
  } else {
    pausedSection.hidden = false
    for (const domain of currentSettings.excludedDomains) {
      const chip = document.createElement('span')
      chip.className = 'chip'
      const text = document.createElement('span')
      text.textContent = domain
      const rmBtn = document.createElement('button')
      rmBtn.type = 'button'
      rmBtn.textContent = '×'
      rmBtn.title = `${domain} entfernen`
      rmBtn.addEventListener('click', () => {
        void saveSettings({
          ...currentSettings,
          excludedDomains: currentSettings.excludedDomains.filter((d) => d !== domain),
        })
      })
      chip.append(text, rmBtn)
      pausedList.appendChild(chip)
    }
  }
}

function formatStatus(status: ExtensionStatus): string {
  const parts: string[] = []
  if (status.de) parts.push(`DE ${status.de.count}`)
  if (status.en) parts.push(`EN ${status.en.count}`)
  if (parts.length === 0) {
    return status.lastError ? `Fehler: ${status.lastError}` : 'Noch nicht synchronisiert'
  }
  const latest = Math.max(status.de?.fetchedAt ?? 0, status.en?.fetchedAt ?? 0)
  const timeStr = latest
    ? new Date(latest).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '—'
  return `${parts.join(' · ')} Begriffe (${timeStr})`
}

async function refreshStatus(): Promise<void> {
  const res = (await chrome.runtime.sendMessage<BackgroundResponse<ExtensionStatus>>({
    type: 'GET_STATUS',
  })) as BackgroundResponse<ExtensionStatus> | undefined
  if (res?.ok) {
    syncStatusEl.textContent = formatStatus(res.data)
  } else {
    syncStatusEl.textContent = res?.error ?? 'Status nicht verfügbar'
  }
}

async function init(): Promise<void> {
  const [stored, tabs] = await Promise.all([
    chrome.storage.sync.get<Record<string, ExtensionSettings>>([STORAGE_KEYS.SETTINGS]),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ])

  if (stored[STORAGE_KEYS.SETTINGS]) {
    currentSettings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.SETTINGS] }
  }

  const rawUrl = tabs[0]?.url
  if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
    try {
      activeHostname = new URL(rawUrl).hostname.toLowerCase()
    } catch {
      activeHostname = null
    }
  }

  renderSettings()
  await refreshStatus()

  enabledToggle.addEventListener('change', () => {
    void saveSettings({ ...currentSettings, enabled: enabledToggle.checked })
  })

  langSelect.addEventListener('change', () => {
    void saveSettings({
      ...currentSettings,
      languageMode: langSelect.value as LanguageMode,
    })
  })

  styleSelect.addEventListener('change', () => {
    void saveSettings({
      ...currentSettings,
      highlightStyle: styleSelect.value as HighlightStyle,
    })
  })

  siteToggleBtn.addEventListener('click', () => {
    if (!activeHostname) return
    const paused = isExcluded(activeHostname, currentSettings.excludedDomains)
    const nextDomains = paused
      ? currentSettings.excludedDomains.filter(
          (d) =>
            d.toLowerCase() !== activeHostname &&
            !activeHostname!.endsWith(`.${d.toLowerCase()}`),
        )
      : [...currentSettings.excludedDomains, activeHostname]
    void saveSettings({ ...currentSettings, excludedDomains: nextDomains })
  })

  syncNowBtn.addEventListener('click', () => {
    syncNowBtn.disabled = true
    syncStatusEl.textContent = 'Synchronisiere…'
    void (async () => {
      try {
        const res = (await chrome.runtime.sendMessage<BackgroundResponse<ExtensionStatus>>({
          type: 'SYNC_NOW',
        })) as BackgroundResponse<ExtensionStatus> | undefined
        if (res?.ok) {
          syncStatusEl.textContent = formatStatus(res.data)
        } else {
          syncStatusEl.textContent = res?.error ?? 'Sync fehlgeschlagen'
        }
      } finally {
        syncNowBtn.disabled = false
      }
    })()
  })
}

void init()
