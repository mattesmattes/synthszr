const API_BASE = 'https://www.synthszr.com'
const INDEX_CACHE_PREFIX = 'synthszr_app_index_v1_'
const LANG_STORAGE_KEY = 'synthszr_app_lang_v1'

const STARTER_TERMS = {
  de: [
    { s: 'large-language-model', n: 'Large Language Model', a: ['LLM'], d: 'Großes Sprachmodell auf Transformer-Basis, das Texte versteht, generiert und komplexe Aufgaben bearbeitet.' },
    { s: 'retrieval-augmented-generation', n: 'Retrieval-Augmented Generation', a: ['RAG'], d: 'Architektur, die Sprachmodelle zur Antwortzeit mit aktuell abgerufenen Fakten aus Datenbanken oder Dokumenten anreichert.' },
    { s: 'model-context-protocol', n: 'Model Context Protocol', a: ['MCP'], d: 'Offener Standard zur strukturierten Anbindung externer Werkzeuge, APIs und Datenquellen an KI-Modelle.' },
    { s: 'ai-agent', n: 'AI Agent', a: ['Agent'], d: 'Autonom agierendes KI-System, das Ziele plant, Werkzeuge aufruft und Zwischenschritte selbstständig ausführt.' },
    { s: 'transformer', n: 'Transformer', a: [], d: 'Neuronale Netzwerkarchitektur mit Self-Attention-Mechanismus, die die Grundlage moderner Sprach- und Multimodelle bildet.' },
    { s: 'embeddings', n: 'Embeddings', a: ['Embedding'], d: 'Numerische Vektor-Repräsentationen von Text, Bildern oder Daten zur semantischen Ähnlichkeitssuche.' },
    { s: 'token', n: 'Token', a: ['Tokenization'], d: 'Kleinste Verarbeitungseinheit eines Sprachmodells — typischerweise Wortteile, Wörter oder Satzzeichen.' },
    { s: 'fine-tuning', n: 'Fine-Tuning', a: ['Finetuning'], d: 'Nachträgliches Spezialisieren eines vortrainierten Modells auf domänenspezifische Daten oder Stile.' },
    { s: 'vibe-coding', n: 'Vibe Coding', a: [], d: 'Softwareentwicklung durch natürlichsprachige Anweisungen an KI-Assistenten statt manueller Code-Eingabe.' },
    { s: 'context-window', n: 'Context Window', a: ['Kontextfenster'], d: 'Maximale Anzahl an Tokens, die ein Modell gleichzeitig im Arbeitsgedächtnis verarbeiten kann.' },
    { s: 'prompt-engineering', n: 'Prompt Engineering', a: [], d: 'Gezielte Gestaltung von Eingabeanweisungen, Kontext und Beispielen für verlässliche Modellantworten.' },
    { s: 'hallucination', n: 'Halluzination', a: ['Hallucination'], d: 'Plausibel klingende, aber faktisch falsche oder frei erfundene Aussage eines generativen KI-Modells.' },
  ],
  en: [
    { s: 'large-language-model', n: 'Large Language Model', a: ['LLM'], d: 'Transformer-based foundation model trained on massive corpora to understand, reason about, and generate text.' },
    { s: 'retrieval-augmented-generation', n: 'Retrieval-Augmented Generation', a: ['RAG'], d: 'Architecture combining neural text generation with live retrieval from external documents or vector databases.' },
    { s: 'model-context-protocol', n: 'Model Context Protocol', a: ['MCP'], d: 'Open standard connecting AI models securely to external tools, repositories, and data sources.' },
    { s: 'ai-agent', n: 'AI Agent', a: ['Agent'], d: 'Autonomous software system powered by an AI model that plans steps, invokes tools, and verifies outcomes.' },
    { s: 'transformer', n: 'Transformer', a: [], d: 'Deep learning architecture built around self-attention, powering modern LLMs and multimodal models.' },
    { s: 'embeddings', n: 'Embeddings', a: ['Embedding'], d: 'Dense vector representations capturing semantic similarity across text, code, or media.' },
    { s: 'token', n: 'Token', a: ['Tokenization'], d: 'Atomic text chunk processed by language models — roughly three quarters of an English word on average.' },
    { s: 'fine-tuning', n: 'Fine-Tuning', a: ['Finetuning'], d: 'Adapting a pre-trained model to domain knowledge, style, or task-specific accuracy.' },
    { s: 'vibe-coding', n: 'Vibe Coding', a: [], d: 'Building software by describing intent in natural language and iterating with AI coding agents.' },
    { s: 'context-window', n: 'Context Window', a: [], d: 'Maximum token capacity a model can attend to within a single prompt and response cycle.' },
    { s: 'prompt-engineering', n: 'Prompt Engineering', a: [], d: 'Structuring instructions, constraints, and examples to steer language model behavior reliably.' },
    { s: 'hallucination', n: 'Hallucination', a: [], d: 'Confident, fluent output from a generative model that is factually unsupported or fabricated.' },
  ],
}

const UI_COPY = {
  de: {
    brandSub: 'LEXIKON',
    statusUnknown: 'Safari-Erweiterung',
    statusOn: 'Aktiv',
    statusOff: 'Inaktiv',
    macUnknown: 'Aktiviere die Safari-Erweiterung in den Safari-Einstellungen und erlaube den Zugriff für alle Websites.',
    macOn: 'Die Safari-Erweiterung ist aktiviert und erklärt Tech- & AI-Begriffe direkt auf jeder Webseite.',
    macOff: 'Die Erweiterung ist installiert, aber aktuell in Safari deaktiviert.',
    macButtonPrefs: 'Safari-Einstellungen öffnen…',
    macButtonSettings: 'Safari-Einstellungen öffnen…',
    iosDesc: 'Aktiviere Synthszr Lexikon unter Einstellungen → Apps → Safari → Erweiterungen und erlaube alle Websites.',
    openWeb: 'Web-Lexikon ↗',
    searchTitle: 'Lexikon durchsuchen',
    refresh: 'Aktualisieren',
    loadingIndex: 'Lade Begriffs-Index…',
    searchPlaceholder: 'Begriff suchen (z. B. Transformer, RAG, MCP)…',
    back: '← Zurück',
    openExternal: 'Auf synthszr.com öffnen ↗',
    related: 'Verwandte Begriffe',
    noResults: 'Keine passenden Begriffe gefunden.',
    starterLabel: '12 Basis-Begriffe offline · Online-Abgleich folgt',
    termsCount: (n) => `${n.toLocaleString('de-DE')} Begriffe verfügbar`,
    alsoKnownAs: 'Auch: ',
    loadingDetail: 'Lade vollständigen Eintrag…',
    detailOffline: 'Volltext benötigt Internetverbindung; Kurzdefinition wird angezeigt.',
    privacyNote: '100 % lokales Matching auf deinem Gerät: Weder dein Browserverlauf noch besuchte Seiteninhalte werden übertragen. Einzelne Definitionen werden erst bei Klick geladen.',
    privacyLink: 'Datenschutz',
    supportLink: 'Hilfe & Lexikon',
  },
  en: {
    brandSub: 'GLOSSARY',
    statusUnknown: 'Safari Extension',
    statusOn: 'Enabled',
    statusOff: 'Disabled',
    macUnknown: 'Enable the Safari extension in Safari Settings and allow access on all websites.',
    macOn: 'The Safari extension is active and explains tech & AI concepts directly on any webpage.',
    macOff: 'The extension is installed, but currently turned off in Safari.',
    macButtonPrefs: 'Open Safari Extensions Preferences…',
    macButtonSettings: 'Open Safari Settings…',
    iosDesc: 'Enable Synthszr Lexikon under Settings → Apps → Safari → Extensions and allow all websites.',
    openWeb: 'Web Glossary ↗',
    searchTitle: 'Browse Glossary',
    refresh: 'Refresh',
    loadingIndex: 'Loading glossary index…',
    searchPlaceholder: 'Search terms (e.g. Transformer, RAG, MCP)…',
    back: '← Back',
    openExternal: 'Open on synthszr.com ↗',
    related: 'Related Terms',
    noResults: 'No matching glossary terms found.',
    starterLabel: '12 starter terms offline · Syncing full index',
    termsCount: (n) => `${n.toLocaleString('en-US')} terms indexed`,
    alsoKnownAs: 'Also: ',
    loadingDetail: 'Loading full entry…',
    detailOffline: 'Full article requires an internet connection; showing cached summary.',
    privacyNote: '100% local matching on your device: browsing history and page contents are never transmitted. Full definitions load only when you click a term.',
    privacyLink: 'Privacy Policy',
    supportLink: 'Support & Glossary',
  },
}

let currentLang = 'de'
let useSettingsLabel = true
let termsByLang = { de: STARTER_TERMS.de, en: STARTER_TERMS.en }
let isSyncedLang = { de: false, en: false }
let detailToken = 0

function readStoredLang() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    if (saved === 'de' || saved === 'en') return saved
  } catch {
    // Ignore storage restrictions
  }
  return navigator.language && navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en'
}

function readCachedIndex(lang) {
  try {
    const raw = localStorage.getItem(INDEX_CACHE_PREFIX + lang)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
      return parsed.items
    }
  } catch {
    // Ignore storage errors
  }
  return null
}

function writeCachedIndex(lang, items) {
  try {
    localStorage.setItem(
      INDEX_CACHE_PREFIX + lang,
      JSON.stringify({ fetchedAt: Date.now(), items }),
    )
  } catch {
    // Ignore quota errors
  }
}

function openExternalUrl(url) {
  if (window.webkit?.messageHandlers?.controller) {
    window.webkit.messageHandlers.controller.postMessage({ action: 'open-url', url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function applyLanguageUI() {
  const c = UI_COPY[currentLang]
  document.documentElement.lang = currentLang

  document.getElementById('brand-sub').textContent = c.brandSub
  document.getElementById('status-unknown').textContent = c.statusUnknown
  document.getElementById('status-on').textContent = c.statusOn
  document.getElementById('status-off').textContent = c.statusOff
  document.getElementById('mac-desc-unknown').textContent = c.macUnknown
  document.getElementById('mac-desc-on').textContent = c.macOn
  document.getElementById('mac-desc-off').textContent = c.macOff
  document.getElementById('open-prefs-btn').textContent = useSettingsLabel
    ? c.macButtonSettings
    : c.macButtonPrefs
  document.getElementById('ios-desc').textContent = c.iosDesc
  document.getElementById('open-web-glossary').textContent = c.openWeb
  document.getElementById('open-web-glossary').href = `${API_BASE}/${currentLang}/glossary`
  document.getElementById('search-title').textContent = c.searchTitle
  document.getElementById('refresh-index-btn').textContent = c.refresh
  document.getElementById('search-input').placeholder = c.searchPlaceholder
  document.getElementById('detail-back-btn').textContent = c.back
  document.getElementById('related-label').textContent = c.related
  document.getElementById('privacy-note').textContent = c.privacyNote
  document.getElementById('privacy-link').textContent = c.privacyLink
  document.getElementById('privacy-link').href = `${API_BASE}/${currentLang}/datenschutz#browser-extension`
  document.getElementById('support-link').textContent = c.supportLink
  document.getElementById('support-link').href = `${API_BASE}/${currentLang}/glossary`

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === currentLang)
  })

  updateIndexStatus()
  renderResults()
}

function updateIndexStatus() {
  const c = UI_COPY[currentLang]
  const el = document.getElementById('index-status')
  const count = termsByLang[currentLang].length
  el.textContent = isSyncedLang[currentLang] ? c.termsCount(count) : c.starterLabel
}

function searchTerms(query) {
  const items = termsByLang[currentLang]
  const q = query.trim().toLowerCase()
  if (!q) return items.slice(0, 40)

  const exact = []
  const prefix = []
  const substring = []

  for (let i = 0; i < items.length; i++) {
    const t = items[i]
    const nLower = t.n.toLowerCase()
    const aliases = Array.isArray(t.a) ? t.a : []

    if (nLower === q || aliases.some((a) => a.toLowerCase() === q)) {
      exact.push(t)
    } else if (nLower.startsWith(q) || aliases.some((a) => a.toLowerCase().startsWith(q))) {
      prefix.push(t)
    } else if (
      nLower.includes(q) ||
      aliases.some((a) => a.toLowerCase().includes(q)) ||
      (t.d && t.d.toLowerCase().includes(q))
    ) {
      substring.push(t)
    }

    if (exact.length + prefix.length >= 60) break
  }

  return [...exact, ...prefix, ...substring].slice(0, 40)
}

function renderResults() {
  const list = document.getElementById('results-list')
  const query = document.getElementById('search-input').value
  const matches = searchTerms(query)

  list.replaceChildren()
  if (matches.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.textContent = UI_COPY[currentLang].noResults
    list.appendChild(empty)
    return
  }

  const frag = document.createDocumentFragment()
  for (const term of matches) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'result-item'

    const title = document.createElement('div')
    title.className = 'result-name'
    const nameSpan = document.createElement('span')
    nameSpan.textContent = term.n
    title.appendChild(nameSpan)

    if (Array.isArray(term.a) && term.a.length > 0) {
      const alias = document.createElement('span')
      alias.className = 'result-alias'
      alias.textContent = term.a.slice(0, 2).join(', ')
      title.appendChild(alias)
    }

    const summary = document.createElement('div')
    summary.className = 'result-summary'
    summary.textContent = term.d || ''

    btn.append(title, summary)
    btn.addEventListener('click', () => openDetail(term))
    frag.appendChild(btn)
  }
  list.appendChild(frag)
}

async function openDetail(term) {
  const token = ++detailToken
  const c = UI_COPY[currentLang]
  const searchView = document.getElementById('search-view')
  const detailView = document.getElementById('detail-view')
  const illWrap = document.getElementById('detail-illustration-wrap')
  const illImg = document.getElementById('detail-illustration')
  const titleEl = document.getElementById('detail-title')
  const aliasesEl = document.getElementById('detail-aliases')
  const summaryEl = document.getElementById('detail-summary')
  const bodyEl = document.getElementById('detail-body')
  const relatedEl = document.getElementById('detail-related')
  const chipsEl = document.getElementById('related-chips')
  const extLink = document.getElementById('detail-external-link')

  searchView.hidden = true
  detailView.hidden = false
  illWrap.hidden = true
  illImg.removeAttribute('src')
  relatedEl.hidden = true
  chipsEl.replaceChildren()

  titleEl.textContent = term.n
  if (Array.isArray(term.a) && term.a.length > 0) {
    aliasesEl.textContent = `${c.alsoKnownAs}${term.a.join(', ')}`
    aliasesEl.hidden = false
  } else {
    aliasesEl.hidden = true
  }
  summaryEl.textContent = term.d || c.loadingDetail
  extLink.href = `${API_BASE}/${currentLang}/glossary/${encodeURIComponent(term.s)}`
  extLink.textContent = c.openExternal

  const loadingP = document.createElement('p')
  loadingP.textContent = c.loadingDetail
  bodyEl.replaceChildren(loadingP)

  try {
    const res = await fetch(`${API_BASE}/api/glossary/term/${encodeURIComponent(term.s)}?lang=${currentLang}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const detail = await res.json()
    if (token !== detailToken) return

    titleEl.textContent = detail.canonicalName || term.n
    if (Array.isArray(detail.aliases) && detail.aliases.length > 0) {
      aliasesEl.textContent = `${c.alsoKnownAs}${detail.aliases.join(', ')}`
      aliasesEl.hidden = false
    }
    if (detail.summary) summaryEl.textContent = detail.summary
    if (detail.url && detail.url.startsWith('https://')) extLink.href = detail.url

    if (detail.illustrationUrl) {
      illImg.onload = () => {
        if (token === detailToken) illWrap.hidden = false
      }
      illImg.onerror = () => {
        illWrap.hidden = true
      }
      illImg.alt = detail.illustrationAlt || detail.canonicalName || term.n
      illImg.src = `${API_BASE}/api/glossary/term/${encodeURIComponent(term.s)}/illustration`
    }

    const frag = document.createDocumentFragment()
    const blocks = Array.isArray(detail.blocks) && detail.blocks.length > 0
      ? detail.blocks
      : (detail.paragraphs || []).map((text) => ({ type: 'paragraph', text }))

    let currentUl = null
    for (const block of blocks) {
      if (block.type === 'listItem') {
        if (!currentUl) {
          currentUl = document.createElement('ul')
          frag.appendChild(currentUl)
        }
        const li = document.createElement('li')
        li.textContent = block.text
        currentUl.appendChild(li)
        continue
      }
      currentUl = null
      if (block.type === 'heading') {
        const h4 = document.createElement('h4')
        h4.textContent = block.text
        frag.appendChild(h4)
      } else if (block.type === 'quote') {
        const bq = document.createElement('blockquote')
        bq.textContent = block.text
        frag.appendChild(bq)
      } else {
        const p = document.createElement('p')
        p.textContent = block.text
        frag.appendChild(p)
      }
    }
    bodyEl.replaceChildren(frag)

    if (Array.isArray(detail.relatedTerms) && detail.relatedTerms.length > 0) {
      for (const rel of detail.relatedTerms) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'chip'
        chip.textContent = rel.canonicalName
        chip.addEventListener('click', () => {
          const found = termsByLang[currentLang].find((item) => item.s === rel.slug)
          void openDetail(found || { s: rel.slug, n: rel.canonicalName, d: '' })
        })
        chipsEl.appendChild(chip)
      }
      relatedEl.hidden = false
    }
  } catch {
    if (token !== detailToken) return
    const fallbackP = document.createElement('p')
    fallbackP.textContent = c.detailOffline
    bodyEl.replaceChildren(fallbackP)
  }
}

function closeDetail() {
  detailToken++
  document.getElementById('detail-view').hidden = true
  document.getElementById('search-view').hidden = false
}

async function syncLanguageIndex(lang, force = false) {
  const cached = !force ? readCachedIndex(lang) : null
  if (cached) {
    termsByLang[lang] = cached
    isSyncedLang[lang] = true
    if (lang === currentLang) {
      updateIndexStatus()
      renderResults()
    }
  }

  try {
    const res = await fetch(`${API_BASE}/api/glossary/extension-index?lang=${lang}`)
    if (!res.ok) return
    const payload = await res.json()
    if (Array.isArray(payload?.items) && payload.items.length > 0) {
      termsByLang[lang] = payload.items
      isSyncedLang[lang] = true
      writeCachedIndex(lang, payload.items)
      if (lang === currentLang) {
        updateIndexStatus()
        renderResults()
      }
    }
  } catch {
    // Keep starter/cached terms when offline
  }
}

window.show = function show(platform, enabled, useSettingsInsteadOfPreferences) {
  document.body.classList.add(`platform-${platform}`)

  if (typeof useSettingsInsteadOfPreferences === 'boolean') {
    useSettingsLabel = useSettingsInsteadOfPreferences
    const c = UI_COPY[currentLang]
    document.getElementById('open-prefs-btn').textContent = useSettingsLabel
      ? c.macButtonSettings
      : c.macButtonPrefs
  }

  if (typeof enabled === 'boolean') {
    document.body.classList.toggle('state-on', enabled)
    document.body.classList.toggle('state-off', !enabled)
  } else {
    document.body.classList.remove('state-on', 'state-off')
  }
}

document.addEventListener('DOMContentLoaded', () => {
  currentLang = readStoredLang()

  const cachedDe = readCachedIndex('de')
  if (cachedDe) {
    termsByLang.de = cachedDe
    isSyncedLang.de = true
  }
  const cachedEn = readCachedIndex('en')
  if (cachedEn) {
    termsByLang.en = cachedEn
    isSyncedLang.en = true
  }

  document.getElementById('open-prefs-btn').addEventListener('click', () => {
    window.webkit?.messageHandlers?.controller?.postMessage('open-preferences')
  })

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.lang
      if (next !== 'de' && next !== 'en') return
      currentLang = next
      try {
        localStorage.setItem(LANG_STORAGE_KEY, next)
      } catch {
        // Ignore storage restrictions
      }
      closeDetail()
      applyLanguageUI()
      if (!isSyncedLang[next]) {
        void syncLanguageIndex(next)
      }
    })
  })

  document.getElementById('search-input').addEventListener('input', () => {
    renderResults()
  })

  document.getElementById('detail-back-btn').addEventListener('click', () => {
    closeDetail()
  })

  document.getElementById('refresh-index-btn').addEventListener('click', () => {
    void syncLanguageIndex(currentLang, true)
  })

  document.querySelectorAll('a[data-external-link]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault()
      openExternalUrl(anchor.href)
    })
  })

  applyLanguageUI()
  void syncLanguageIndex(currentLang)
})
