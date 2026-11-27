# Synthszr Lexikon — Browser-Erweiterung (Chrome / Chromium MV3)

Erkennt automatisch Begriffe aus dem zweisprachigen Synthszr-Lexikon (`https://www.synthszr.com/de/glossary` & `/en/glossary`) auf beliebigen HTML-Seiten, unterstreicht sie dezent gelb über die native **CSS Custom Highlight API** und öffnet beim Klick einen isolierten **Shadow-DOM-Erklärungs-Layer**.

## Lokales Build & Installation in Chrome

1. Erweiterung bauen (erzeugt `dist/` und `.zip`):
   ```bash
   pnpm ext:build
   ```
2. In Chrome `chrome://extensions/` öffnen.
3. Oben rechts **Entwicklermodus** aktivieren.
4. Auf **Entpackte Erweiterung laden** klicken und den Ordner `extensions/synthszr-glossary/dist` auswählen.

## Architektur & Umsetzungsstrategien

- **Zero DOM Mutation:** Keine `<span>`-Wrapper — Markierungen entstehen über `CSS.highlights` + `Range` (`::highlight(synthszr-glossary)`). React/Next.js-Hydration, Layout (CLS = 0) und Web-Editoren bleiben unberührt.
- **O(n) Aho-Corasick Matcher:** Alle ~3.300+ Begriffe und Synonyme werden einmalig in einen Trie mit Failure-Links kompiliert. Unicode-Wortgrenzen schützen deutsche Komposita (z. B. kein Treffer von „Agent“ in „Agentur“); kurze Großbuchstaben-Kürzel (`RAG`, `MCP`, `LLM`) prüfen exakte Schreibweise.
- **Homonym-Kontext-Gating:** Mehrdeutige Alltagswörter (`Agent`, `Model`, `Token`, `Prompt` usw.) werden nur markiert, wenn auf derselben Seite mindestens zwei eindeutige KI-Lexikonbegriffe vorkommen.
- **ETag-Delta-Sync:** Der Background Service Worker synchronisiert `/api/glossary/extension-index?lang=de|en` alle 6 Stunden per `chrome.alarms` mit `If-None-Match` (`304 Not Modified`) in `chrome.storage.local`. Neue Lexikon-Einträge erscheinen ohne Extension-Update.
- **CSP- & XSS-Schutz:** Alle API-Requests laufen im Service Worker; das Backend liefert reines JSON ohne HTML; das Shadow-DOM-Popover nutzt ausschließlich `createElement` + `textContent` (kein `innerHTML`, kein `<iframe>`).
- **Privacy-by-Design:** Besuchte URLs verlassen niemals den Browser — nur `lang` und bei Klick der `slug` werden abgefragt.
