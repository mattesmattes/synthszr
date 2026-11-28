# Synthszr Lexikon — App Store Connect Submission Kit

Dieses Dokument enthält alle vorbereiteten Texte, Prüfpunkte und Terminal-Befehle für die Einreichung von **Synthszr Lexikon** (macOS & iOS Safari Web Extension + eigenständige Lexikon-App) im Apple App Store.

---

## 1. Technische Voraussetzungen im Build (bereits automatisiert)

`npm run ext:build:safari` synchronisiert alle Assets nicht-destruktiv in das Xcode-Projekt (`extensions/synthszr-glossary/safari/Synthszr Lexikon/Synthszr Lexikon.xcodeproj`), ohne Xcode-Signing-Einstellungen zu überschreiben (`--regenerate` nur bei bewusster Neu-Generierung):

- **Guideline 4.2 (Eigenständiger App-Nutzen):** Die Container-App (`safari-app/`) bietet neben dem Safari-Aktivierungsstatus eine vollwertige zweisprachige **Lexikon-Suche** mit Inline-Detailansicht, Dither-Illustrationen, verwandten Begriffen und 12 Offline-Basisbegriffen.
- **Privacy Manifest (`PrivacyInfo.xcprivacy`):** In Host-App und Extension eingebettet (`NSPrivacyTracking = false`, keine erfassten Daten).
- **App Store Icon Compliance:** `universal-icon-1024@1x.png` wird als opakes `1024×1024` RGB-PNG ohne Alpha-Kanal generiert (verhindert Apple ITMS-90717).
- **Info.plist Keys:** `LSApplicationCategoryType = public.app-category.reference`, `ITSAppUsesNonExemptEncryption = NO`, synchronisierte `MARKETING_VERSION` (`manifest.json`).

---

## 2. App Store Connect Metadaten

- **App Name:** `Synthszr Lexikon`
- **Subtitle (DE, max. 30 Zeichen):** `KI- & Tech-Begriffe erklärt`
- **Subtitle (EN, max. 30 Zeichen):** `AI & Tech Terms Explained`
- **Bundle ID:** `com.synthszr.glossary` (Extension: `com.synthszr.glossary.Extension`)
- **Primary Category:** `Reference` (Nachschlagewerke)
- **Secondary Category:** `Utilities` (Dienstprogramme) / `Productivity`
- **Pricing:** Free (ohne In-App-Käufe, ohne Login-Zwang)
- **Privacy Policy URL (DE):** `https://www.synthszr.com/de/datenschutz#browser-extension`
- **Privacy Policy URL (EN):** `https://www.synthszr.com/en/datenschutz#browser-extension`
- **Support URL:** `https://www.synthszr.com/de/glossary` (bzw. `/en/glossary`)
- **Export Compliance:** `ITSAppUsesNonExemptEncryption = NO` (keine eigene Verschlüsselung; nur Standard-HTTPS über Apple `URLSession`/Browser)

### App Privacy Questionnaire (App Store Connect)
- **Do you or your third-party partners collect data from this app?** → **No, we do not collect data from this app** (*Data Not Collected*).
- Begründung: Das gesamte Begriffs-Matching läuft 100 % lokal auf dem Gerät; es gibt keine Nutzerkonten, Cookies, Analytics oder Tracking-SDKs.

---

## 3. Store-Beschreibung (Copy & Paste)

### Deutsch
> **Verstehe KI-, Tech- und Business-Begriffe direkt beim Lesen im Web — oder schlage sie jederzeit direkt in der App nach.**
>
> **Synthszr Lexikon** verbindet eine kompakte Safari-Erweiterung mit einer eigenständigen Nachschlage-App für über 3.300 kuratierte Begriffe auf Deutsch und Englisch:
>
> - **Direkt im Kontext:** Erkannte Fachbegriffe (wie LLM, RAG, MCP, Transformer, Agent oder Vibe Coding) werden dezent im Text hervorgehoben. Ein Klick öffnet eine übersichtliche Erklärung samt animierter Dither-Illustration und verwandten Begriffen — ohne die Seite zu verlassen.
> - **Eigenständiges Lexikon in der App:** Durchsuche alle über 3.300 Einträge auch direkt in der macOS- bzw. iOS-App, inklusive Offline-Starter-Glossar.
> - **100 % lokal & datensparsam:** Der Begriffs-Index wird lokal zwischengespeichert. Besuchte Webseiten, URLs und dein Browserverlauf verlassen zu keinem Zeitpunkt dein Gerät. Erst bei aktivem Klick auf einen Begriff wird dessen Eintrag von `synthszr.com` geladen.
> - **Kontrolle pro Website:** Einzelne Domains lassen sich jederzeit mit einem Klick pausieren; Markierungsstil und Sprache (Auto / DE / EN) sind frei wählbar.

**Keywords (DE, max. 100 Zeichen):**
`KI,AI,Lexikon,Glossar,Safari,Tech,LLM,RAG,Begriffe,Wörterbuch,Nachschlagewerk,Entwicklung`

### English
> **Understand AI, tech, and digital business concepts directly while browsing — or look them up anytime in the standalone glossary app.**
>
> **Synthszr Lexikon** pairs a lightweight Safari Web Extension with a standalone bilingual glossary app covering 3,300+ curated entries in English and German:
>
> - **In-Context Explanations:** Recognized terms (such as LLM, RAG, MCP, Transformer, AI Agent, or Vibe Coding) are subtly underlined on webpages without modifying page layouts. Click any term for a concise explanation, dither illustration, and related concepts.
> - **Standalone Glossary Browser:** Search and read all 3,300+ entries directly inside the macOS or iOS companion app, including a built-in offline starter set.
> - **100% On-Device Privacy:** The term index is cached locally and all webpage scanning happens strictly in local browser memory. Visited URLs, browsing history, and page contents are never transmitted anywhere. Full entries load only on explicit click.
> - **Per-Site Controls:** Pause any website with one click and switch between Auto / EN / DE or underline styles anytime.

**Keywords (EN, max. 100 Zeichen):**
`AI,glossary,dictionary,Safari,extension,LLM,RAG,tech,reference,terminology,machine learning`

---

## 4. App Review Notes (Copy & Paste in App Store Connect — English)

> **How to test Synthszr Lexikon:**
>
> 1. **Standalone App:** Launch *Synthszr Lexikon*. You can immediately search and read glossary terms (e.g., "Large Language Model", "RAG", "MCP") directly inside the app without enabling Safari first.
> 2. **Safari Extension:** Click *"Open Safari Settings…"* (macOS) or open *Settings → Apps → Safari → Extensions* (iOS), enable **Synthszr Lexikon**, and grant permission for **"All Websites"**.
> 3. **Verify in Safari:** Open `https://en.wikipedia.org/wiki/Large_language_model` or `https://www.synthszr.com`. Recognized AI & technology terms appear underlined in neon-lime. Click any highlighted term (e.g., "Transformer", "LLM", "Embeddings") to open the inline explanation popover.
>
> **Why All-Websites Permission (`http://*/*`, `https://*/*`) is required & Privacy guarantees:**
> Synthszr Lexikon acts as a universal reading companion across news sites, documentation, blogs, and research papers.
> - The public term index (`/api/glossary/extension-index`) is cached locally via `browser.storage.local`.
> - All text scanning executes **100% locally inside browser memory** using a word-token index.
> - **Zero** visited URLs, browsing history, cookies, or page contents are ever sent to our servers or any third party.
> - Network requests (`GET https://www.synthszr.com/api/glossary/term/<slug>`) occur **strictly on demand** when the user explicitly clicks a highlighted term to read its full entry.
> - No user account, login, paywall, analytics SDK, or tracking identifier is used.

---

## 5. Build, Archive & Upload (macOS / Xcode)

### A. Xcode-Projekt mit deinem Apple Developer Team bauen & öffnen
```bash
APPLE_TEAM_ID="DEINE_10_STELLIGE_TEAM_ID" npm run ext:build:safari
open "extensions/synthszr-glossary/safari/Synthszr Lexikon/Synthszr Lexikon.xcodeproj"
```

### B. App Store Upload via Xcode
1. In Xcode links oben Ziel wählen: **`Synthszr Lexikon (macOS)` → `Any Mac (arm64, x86_64)`** (für iOS analog `Synthszr Lexikon (iOS)` → `Any iOS Device (arm64)`).
2. Unter *Signing & Capabilities* für sowohl App-Target als auch Extension-Target prüfen, dass dein **Apple Developer Team** gesetzt ist und die `CURRENT_PROJECT_VERSION` (Build-Nummer) bei jedem neuen Upload hochgezählt wird.
3. Menü: **Product → Archive** → **Distribute App → App Store Connect → Upload**.
4. Nach Verarbeitung im App Store Connect zunächst per **TestFlight** kurz gegenprüfen, dann **Submit for Review**.

### C. Optionale Alternative für macOS-Direktdownload (ohne App Store)
Mit `Developer ID Application` Signatur + `xcrun notarytool submit` lässt sich die gebaute `.app` als `.dmg` direkt auf `synthszr.com` anbieten (Gatekeeper-verifiziert ohne App-Store-Wartezeit).

### D. Chrome Web Store (Parallel)
Das bereits gebaute Paket `extensions/synthszr-glossary/synthszr-glossary-v1.0.9.zip` lässt sich direkt im [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) hochladen ($5 einmalige Registrierungsgebühr).
