# Security Re-Audit — Synthszr

> ## ⬛ Remediation-Status — 2. August 2026, nach Umsetzung
>
> Die Befunde unterhalb dieses Kastens beschreiben den Zustand **vor** der
> Remediation und bleiben als Audit-Historie unverändert. Der aktuelle Stand:
>
> | Severity | offen | Details |
> |---|---:|---|
> | Critical | 0 | – |
> | High | 0 | – |
> | Medium | 1 (teilweise) | SEC-009 — `unsafe-eval` entfernt, `unsafe-inline` ist accepted risk |
> | Medium | 1 (ausgeschlossen) | SEC-010 — Gmail-Verschlüsselung per Auftraggeber-Entscheid nicht umgesetzt |
> | Low | 1 (neu) | SEC-016 — neu gefunden, siehe unten |
> | **geschlossen** | **13** | SEC-001 bis -008, -011 bis -015 |
>
> ### Evidenz pro Finding
>
> | ID | Status | Evidenz |
> |---|---|---|
> | SEC-001 | **geschlossen** | Purpose-Tokens (`subscriber_action_tokens`), nur SHA-256-Hashes. Prod-verifiziert: Subscriber-UUID an confirm/preferences/unsubscribe/referral je abgewiesen; Signup antwortet einheitlich 202; Unsubscribe ist single-use; Legacy-Schema gedroppt. |
> | SEC-002 | **geschlossen** | Cron akzeptiert nur Bearer. Prod: ohne Auth, mit `x-vercel-cron: 1` und mit falschem Bearer je 401. Negativtest in `tests/lib/security.test.ts`. |
> | SEC-003 | **geschlossen** | Prod: OAuth-Callback ohne und mit falschem `state` → `error=invalid_state`. |
> | SEC-004 | **geschlossen** | Pro Hop ein undici-`Agent`, dessen `connect.lookup` die validierte IP liefert; Host/SNI bleiben korrekt. Integrationstest gegen echten Socket. Tracking-Resolver läuft über `safeFetch`. |
> | SEC-005 | **geschlossen mit Ausnahme** | Ein Lockfile, `packageManager` + `engines` gepinnt, `npx` aus dem Build. 1 Critical + 28 High → 0 blockierend. Einzige Ausnahme `sharp` (GHSA-f88m-g3jw-g9cj), dokumentiert in `pnpm.auditExceptionNotes`; Exposition durch SEC-007 auf Allowlist + 8 MiB + 16 MP begrenzt. |
> | SEC-006 | **geschlossen** | anon-Leseprobe über alle 68 Tabellen: 12 lesbar, alle davon gewollt öffentlich. `generated_posts` liefert anon 217 (= published), service_role 243 — 26 Drafts unsichtbar. |
> | SEC-007 | **geschlossen** | Byte-, Pixel- und MIME-Limits, exakte Host-Allowlist. Prod: fremder Host und `169.254.169.254` je 403. |
> | SEC-008 | **geschlossen** | Zod-Schemas, 8-KiB-Body-Limit, Rate-Limit vor Parsing. Prod: ungültiger `eventType` → 400, 9-KiB-Body → 413. Retention-Cron läuft (338 Zeilen im ersten Lauf). |
> | SEC-009 | **TEILWEISE** | `unsafe-eval` produktiv entfernt; über alle vier betroffenen Konstrukte als entbehrlich verifiziert. `unsafe-inline` bleibt: 32 un-noncte Inline-Scripts pro Seite, Nonces würden ISR auf 21 Routen kosten. Accepted risk, Owner Mattes, Test sichert die Ausnahme ab. |
> | SEC-010 | **ausgeschlossen** | Auf Entscheid des Auftraggebers nicht umgesetzt. Gmail-Refresh-Token liegt weiterhin im Klartext in `gmail_tokens`. Rotationsprozedur in `docs/security/security-runbook.md`. |
> | SEC-011 | **geschlossen** | `instrumentation.ts` erzwingt die Config beim Boot; Enforcement an `VERCEL_ENV`, damit Previews nicht sterben. Rate-Limit-Check akzeptiert das real genutzte `KV_REST_API_*`-Paar. |
> | SEC-012 | **geschlossen** | Alle CI-Jobs auf pnpm/Node 24, Audit- und Semgrep-Gate blockierend, Actions auf Commit-SHAs gepinnt. Dabei aufgedeckt: das Semgrep-Gate hatte **nie** gescannt (`--config auto` ohne Token, unparsebares YAML, nicht ladende Regel) — jetzt 606 Dateien, 0 ERROR-Findings, eigener Step failt bei Rule-Parse-Errors. |
> | SEC-013 | **geschlossen** | Prod: `GET …?generate=true` → 400, published-Gate aktiv, POST admin-only. |
> | SEC-014 | **geschlossen** | Eigenes `REVALIDATE_SECRET`, timing-safe im Header. Prod: Query-Secret → 401, korrekter Bearer → 200. |
> | SEC-015 | **geschlossen** | Opake 256-Bit-Sessions, Hash in `admin_sessions`, 12 h TTL, sofort widerrufbar. Prod: Logout → altes Cookie 307/401. Dabei aufgedeckt: die Middleware hatte eine zweite JWT-Implementierung mit `JWT_SECRET \|\| ADMIN_PASSWORD` als Key — das Login-Passwort genügte zum Fälschen eines Cookies. |
>
> ### SEC-016 (neu, Low) — `newsletter_sources.email` für `anon` lesbar
>
> Die anon-Leseprobe über alle Tabellen zeigt: `newsletter_sources` liefert 221
> Zeilen inklusive Spalte `email` (Absenderadressen der abonnierten
> Newsletter, z. B. `techpresso@dupple.com`).
>
> **Ursache:** `app/[lang]/sources/page.tsx` liest serverseitig mit dem
> **anon**-Key und selektiert `email`, um daraus per
> `deriveWebsiteFromEmail()` die Website-Domain abzuleiten. Gerendert wird die
> Adresse nicht. Weil der anon-Key benutzt wird, muss `anon` die Spalte lesen
> dürfen — und kann sie damit auch direkt über PostgREST abfragen.
>
> **Risiko: Low.** Keine Nutzerdaten, sondern Verteileradressen, deren Namen
> und Websites die Seite ohnehin öffentlich zeigt. Ein Angreifer erfährt,
> welche Absender die Ingestion akzeptiert; ein Spoofing-Versuch müsste
> zusätzlich SPF/DKIM des jeweiligen Absenders überwinden und im
> Gmail-Postfach landen.
>
> **Fix (nicht umgesetzt, außerhalb des Remediation-Plans):**
> `sources/page.tsx` auf einen serverseitigen Admin-Client oder eine
> API-Route umstellen, danach `revoke all … from anon` auf
> `newsletter_sources`. Alle übrigen Zugriffe auf die Tabelle sind bereits
> serverseitig und admin-authentifiziert.
>
> ### Weitere Beobachtungen ohne Security-Bezug
>
> - `pnpm lint` ist nicht ausführbar: `package.json` deklariert
>   `"lint": "eslint ."`, aber `eslint` ist keine Dependency
>   (`eslint: command not found`). Vorbestehend; die CI ruft `lint` nicht auf.
> - Der OAuth-Fehlerredirect zeigt auf `synthszr.vercel.app` statt
>   `www.synthszr.com` (`NEXT_PUBLIC_APP_URL`/`BASE_URL`-Konfiguration).
> - Es ist keine Tip-Promo aktiv, daher enthält der Newsletter derzeit keinen
>   Empfehlungs-Link; der `referral`-Token wird trotzdem pro Empfänger auf
>   Vorrat gemintet.
> - Browser-Smoke der CSP wurde **nicht** durchgeführt (Chrome-Extension nicht
>   verbunden). Statisch verifiziert, Laufzeitverhalten im Browser ungeprüft.
>
> **Prozeduren:** `docs/security/security-runbook.md`
> **Umsetzungsverlauf:** `docs/superpowers/plans/2026-08-02-security-remediation.md`

**Stand:** 2. August 2026  
**Revisionsbasis:** `23c74ca` plus aktueller Workspace  
**Stack:** Next.js 16, TypeScript, React 19, Supabase/Postgres, Vercel, Google OAuth/Gmail, Resend, Upstash  
**Modus:** Code-, Konfigurations- und Dependency-Prüfung plus ausschließlich read-only Produktionsproben; keine Exploits und keine Datenänderungen

## Executive Summary

Die umgesetzten Maßnahmen haben die Sicherheitslage deutlich verbessert. Drei der vormals wichtigsten Findings sind in Code und – soweit read-only prüfbar – in Produktion geschlossen:

- Cron-Routen akzeptieren nur noch `Authorization: Bearer $CRON_SECRET`.
- Beide Google-OAuth-Flows verwenden kurzlebiges, single-use `state`; der Gmail-Callback verlangt zusätzlich eine Admin-Session.
- Die global permissiven Supabase-Policies wurden entfernt. Die erweiterte Produktionsprobe bestätigt, dass die betroffenen nicht-leeren Tabellen für `anon` keine Zeilen mehr liefern.

Der Stand ist trotzdem **noch nicht vollständig security-ready**. Es gibt kein Critical Finding mehr, aber drei High-Risk-Befunde bleiben offen oder nur teilweise gelöst:

1. Die rohe Subscriber-UUID bleibt ein weitreichendes Bearer-Secret. Für neue E-Mail-Adressen kann ein Angreifer die Anmeldung initiieren, die zurückgegebene `sid` behalten und nach dem Double-Opt-in des Opfers einen Preference-Token minten.
2. Der SSRF-Guard blockiert jetzt IPv4-mapped IPv6 korrekt und validiert Redirects, bindet die geprüfte DNS-Adresse aber nicht an die Verbindung. Der Webcrawl-Tracking-Resolver umgeht den Guard weiterhin vollständig.
3. Beide Lockfiles enthalten noch kritische bzw. hochriskante Dependencies. Besonders relevant ist `sharp@0.34.5`, weil öffentliche Endpoints fremde Bilder ungegrenzt an Sharp übergeben.

Ein weiterer vermeintlich umgesetzter Fix greift nicht am tatsächlichen Reader-Pfad: `/api/podcast/generate` und der POST-Handler sind geschützt, aber `GET /api/podcast/[postId]?generate=true` startet weiterhin öffentlich LLM- und TTS-Arbeit.

### Offene Befunde

| Severity | Anzahl | IDs |
|---|---:|---|
| Critical | 0 | – |
| High | 3 | SEC-001, SEC-004, SEC-005 |
| Medium | 6 | SEC-007 bis SEC-010, SEC-012, SEC-013 |
| Low | 3 | SEC-011, SEC-014, SEC-015 |
| **Offen/teilweise offen** | **12** | |
| **Gelöst** | **3** | SEC-002, SEC-003, SEC-006 |

### Delta zum Audit vom 1. August

| ID | Vorher | Jetzt | Status |
|---|---|---|---|
| SEC-001 | Critical | High | Teilweise gelöst |
| SEC-002 | High | – | Gelöst; Test/Dokumentation veraltet |
| SEC-003 | High | – | Gelöst |
| SEC-004 | High | High | Teilweise gelöst |
| SEC-005 | High | High | Verbessert, weiterhin offen |
| SEC-006 | High | – | Gelöst in Code und produktivem Read-Pfad |
| SEC-007 | Medium | Medium | Offen |
| SEC-008 | Medium | Medium | Offen |
| SEC-009 | Medium | Medium | Offen und produktiv bestätigt |
| SEC-010 | Medium | Medium | Offen |
| SEC-011 | Low | Low | Offen |
| SEC-012 | Medium | Medium | Offen |
| SEC-013 | Medium | Medium | Offen; anderer Triggerpfad blieb bestehen |
| SEC-014 | Low | Low | Offen |
| SEC-015 | Low | Low | Offen |

## Scope und Methodik

- 670 TypeScript-/TSX-Dateien in `app`, `components`, `lib` und `scripts`
- 150 Route Handler, davon 86 unter `/api/admin` und 5 unter `/api/cron`
- 97 aktive Supabase-Migrationen
- Authentifizierung, Autorisierung, BOLA/IDOR, CSRF, OAuth, SSRF, XSS/CSP, Secrets, Datenbank/RLS, Rate Limits, Webhooks, Logging, Dependencies und CI/CD
- Read-only Supabase Data API Probe über 83 bekannte Tabellen-/View-Namen mit `anon` versus `service_role`, ausschließlich `HEAD`/Count
- Produktive Negativproben für Cron ohne Auth und OAuth-Callback ohne `state`
- `pnpm audit` gegen `pnpm-lock.yaml` und `npm audit` gegen `package-lock.json`
- redaktierter Secret-Scan des aktuellen Workspace und heuristischer Git-History-Scan; keine Secret-Werte wurden ausgegeben
- TypeScript-Check sowie vollständiger und gezielter Vitest-Lauf

### Verifikationsergebnisse

| Prüfung | Ergebnis |
|---|---|
| `pnpm exec tsc --noEmit` | bestanden |
| kompletter Vitest-Lauf | 373/395 Tests bestanden |
| erklärbare externe Testfehler | 21 durch gesperrte externe API-/DB-Netzwerkzugriffe |
| echte Testregression | 1: Test erwartet weiterhin `x-vercel-cron` als gültige Auth |
| gezielte SSRF-Tests | 26/26 bestanden |
| gezielte Security-Tests | 8/9 bestanden; nur der veraltete Cron-Test scheitert |
| aktueller Secret-Scan | keine bestätigten Secrets; nur Platzhalter/Testwerte |
| Git-History-Heuristik | 0 Treffer für die geprüften Key-Formate |
| `pnpm audit` | 1 critical, 28 high, 19 moderate, 5 low |
| `npm audit` | 1 critical, 10 high, 16 moderate, 3 low |
| Supabase anon-Probe | 47 nicht-leere interne Tabellen blockiert; 12 beabsichtigte öffentliche Read-Tabellen |
| Production Cron ohne Auth | HTTP 401 |
| Production OAuth-Callback ohne `state` | Redirect auf `invalid_state` |
| Production Security Header | HSTS, CSP, `nosniff`, Frame-Schutz und Permissions Policy aktiv |
| Vercel CLI | 58.4.4; aktuell |

## Priorisierte Maßnahmen

### P0 — vor dem nächsten Release

1. SEC-001 vollständig schließen: rohe `subscriber.id` weder ausgeben noch als Autorisierung akzeptieren; öffentliches Preference-Token-Minting entfernen.
2. SEC-005 schließen: einen Lockfile-Graph festlegen; `sharp`, Vitest und die verbleibenden Critical/High-Pfade aktualisieren oder belastbar mitigieren.
3. SEC-004 schließen: Tracking-Resolver auf den zentralen Guard umstellen und DNS-Pinning bzw. einen Egress-Proxy einführen.
4. SEC-013 am tatsächlichen Reader-GET schließen oder mit globalem Budget, aktiven Locales und Published-Post-Check absichern.

### P1 — innerhalb von 7 Tagen

1. Image-Proxies mit Redirect-Revalidierung, Timeout, MIME-/Magic-Byte-Check, Downloadlimit und Rate Limit härten.
2. Analytics-Writes rate-limiten und Body-/Schema-Grenzen setzen.
3. CI auf genau einen Package Manager umstellen; Audit und Semgrep blocking machen; fehlendes `tsx` deklarieren.
4. Veralteten Cron-Security-Test und öffentliche Architektur-Dokumentation korrigieren; OAuth-/Subscriber-Regressionstests ergänzen.

### P2 — innerhalb von 30 Tagen

1. CSP ohne produktives `unsafe-eval` ausrollen und Nonce-/SRI-Strategie für Scripts bewerten.
2. Gmail-Refresh-Token anwendungsseitig verschlüsseln und rotierbar machen.
3. Startup-Enforcement aktivieren, Revalidate-Secret entkoppeln und Admin-Session-Revocation einführen.

---

## Detaillierte Befunde

## SEC-001 — Subscriber-UUID bleibt ein wiederverwendbares Master-Credential

**Status:** Teilweise gelöst  
**Severity:** High, zuvor Critical  
**Klasse:** CWE-639 / CWE-862 / BOLA-IDOR  
**Orte:**

- `app/api/newsletter/subscribe/route.ts:49-66`, `117-154`
- `app/api/newsletter/preferences/route.ts:12-63`, `74-149`, `161-205`
- `app/api/newsletter/unsubscribe/route.ts:20-79`
- `app/api/newsletter/set-language/route.ts:10-99`
- `components/newsletter.tsx:47-57`
- `components/newsletter-popup.tsx:146-162`
- `components/bloom-language-switcher.tsx:80-91`
- `components/referral-sid-fallback.tsx:6-14`
- `lib/resend/templates/newsletter.tsx:140-165`
- `app/[lang]/referral/page.tsx:129-164`, `195-213`

**Was gelöst wurde:** Für bereits existierende aktive, pending oder abgemeldete Adressen liefert `/subscribe` keine `sid` mehr. Der vormals direkt ausnutzbare bekannte-E-Mail-zu-UUID-Pfad ist geschlossen.

**Verbleibende Evidenz:**

```ts
// Neue Anmeldung liefert weiterhin die interne Primary-Key-UUID.
return NextResponse.json({
  success: true,
  message: 'Confirmation email sent',
  sid: newSubscriber?.id,
})
```

```ts
// Öffentlicher Token-Mint akzeptiert ausschließlich diese UUID.
const { subscriberId } = await request.json()
const token = crypto.randomUUID()
await supabase.from('subscriber_preference_tokens').insert({
  subscriber_id: subscriberId,
  token,
  expires_at: expiresAt.toISOString(),
})
return NextResponse.json({ token })
```

Der Token-Mint löscht vorher sogar alle alten Preference-Tokens dieses Subscribers. Die UUID autorisiert außerdem Unsubscribe, Sprachwechsel und die Referral-Übersicht. Sie wird in `localStorage` gespeichert und als `sid` an interne Newsletter-Links angehängt.

**Bestätigter Rest-Angriffspfad:**

1. Angreifer startet eine Anmeldung für eine noch unbekannte Opferadresse und erhält deren neue `sid`.
2. Das Opfer erhält die Double-Opt-in-Mail und bestätigt die vermeintlich eigene Anmeldung.
3. Der Angreifer behält die UUID und mintet später über `POST /api/newsletter/preferences` einen 30-Tage-Token.
4. `GET /api/newsletter/preferences?token=...` liefert die bestätigte E-Mail und Präferenzen; weitere Endpoints erlauben Änderung, Abmeldung und Zugriff auf maskierte Referral-Metadaten.

Unabhängig davon bleibt E-Mail-Enumeration bestehen: Eine aktive Adresse ergibt HTTP 409, eine unbekannte/pending Adresse einen anderen Response-Pfad.

**Impact:** Account-Pre-Hijacking nach Double-Opt-in, PII-Offenlegung, Invalidierung legitimer Preference-Tokens, Präferenzmanipulation, Abmeldung und Referral-Metadatenzugriff. Ein separater SID-Leak über URL-Logs, Browser-History, Extensions oder XSS hat dieselben Folgen.

**Fix:**

- Niemals `subscriber.id` an den Browser oder in E-Mail-URLs geben.
- Subscribe immer mit semantisch gleicher Response beantworten; Status und Body dürfen Existenz nicht verraten.
- `POST /preferences` entfernen oder ausschließlich serverintern/Admin-authentifiziert aufrufen.
- Pro Zweck getrennte, zufällige Tokens für Confirm, Preferences, Unsubscribe und Referral verwenden; serverseitig nur Hash, Zweck, Ablauf, Status und Rotation speichern.
- Preference-/Referral-Zugriff nur über einen an die hinterlegte E-Mail gesendeten Magic-Link erlauben.
- Bestehende `sid`-URLs und `localStorage`-Werte migrieren; bestehende Tokens nach Umstellung invalidieren.

**Mitigation:** Preference-POST am Edge blockieren; neue Subscribe-Response sofort ohne `sid` ausliefern; UUID-basierte Language-/Referral-Funktionen vorübergehend deaktivieren.

**False-Positive-Hinweis:** Der alte Critical-Pfad gegen bestehende aktive Adressen ist tatsächlich geschlossen. Der beschriebene Restpfad benötigt eine neue Opferadresse plus spätere Bestätigung oder einen separaten SID-Leak; deshalb High statt Critical.

---

## SEC-002 — Cron-Header-Spoofing

**Status:** Gelöst im Runtime-Code  
**Vorherige Severity:** High  
**Klasse:** CWE-287 / CWE-306  
**Orte:**

- `lib/security/cron-auth.ts:54-78`
- `middleware.ts:174-191`
- Regression: `tests/lib/security.test.ts:37-50`
- veraltete Dokumentation: `app/docs/architecture/page.tsx:80`, `1238`

**Verifikation:** Der `x-vercel-cron`-Zweig wurde entfernt. `verifyCronAuth` akzeptiert ausschließlich den timing-safe verglichenen Bearer-Token. Auch der `/api/admin`-Middleware-Pfad akzeptiert nur `Authorization: Bearer $CRON_SECRET`. Die produktive Negativprobe ohne Auth liefert HTTP 401.

Das entspricht der aktuellen Vercel-Dokumentation: Vercel sendet `CRON_SECRET` automatisch als Bearer-Authorization-Header.

**Verbleibende Arbeit:** Der Test erwartet weiterhin, dass `x-vercel-cron: 1` autorisiert, und scheitert deshalb. Er muss in einen negativen Regressionstest geändert werden. Die öffentliche Architektur-Seite behauptet ebenfalls noch das alte Verhalten.

**False-Positive-Hinweis:** Kein verbleibender Auth-Bypass im geprüften Code bestätigt. Die veralteten Artefakte sind Wartungsrisiken, aber keine aktuelle Runtime-Lücke.

---

## SEC-003 — Fehlendes OAuth-`state`

**Status:** Gelöst  
**Vorherige Severity:** High  
**Klasse:** CWE-352 / OAuth Login CSRF  
**Orte:**

- `app/api/auth/google/route.ts:1-25`
- `app/api/auth/google/callback/route.ts:6-31`
- `lib/auth/google.ts:8-33`
- `app/api/gmail/authorize/route.ts:1-34`
- `app/api/gmail/callback/route.ts:8-34`
- `lib/gmail/oauth.ts:8-27`

**Verifikation:** Beide Start-Routen erzeugen `randomUUID()` als `state` und speichern sie zehn Minuten in einem `HttpOnly`, in Produktion `Secure`, `SameSite=Lax` Cookie mit `path=/`. Beide Callbacks löschen das Cookie vor der weiteren Verarbeitung und lehnen fehlendes oder abweichendes `state` ab. Gmail verlangt zusätzlich eine gültige Admin-Session. Die produktive Probe ohne `state` wurde auf `invalid_state` umgeleitet.

Google verlangt genau diese Bindung zwischen gestartetem und empfangenem Flow zur CSRF-Abwehr.

**Restempfehlung:** Negative Tests für fehlendes, falsches, abgelaufenes und wiederverwendetes `state` ergänzen. PKCE wäre zusätzliche Härtung für den Gmail-Flow, ist aber nicht Voraussetzung, um dieses Finding zu schließen.

**False-Positive-Hinweis:** Kein verbleibender OAuth-CSRF-Pfad bestätigt.

---

## SEC-004 — SSRF-Härtung ist unvollständig

**Status:** Teilweise gelöst  
**Severity:** High  
**Klasse:** CWE-918  
**Orte:**

- `lib/security/ssrf.ts:58-152`, `155-279`
- `lib/webcrawl/processor.ts:15-40`
- Tests: `tests/lib/ssrf.test.ts:12-137`

**Was gelöst wurde:** IPv4-mapped IPv6 wird jetzt auch in Hex-/komprimierter Form erkannt. `safeFetch` validiert Startziel und jeden Redirect-Hopp manuell. Alle 26 gezielten SSRF-Tests bestehen, einschließlich `::ffff:7f00:1` und `::ffff:a9fe:a9fe`.

**Verbleibende Evidenz:** `assertPublicUrl` löst den Host auf und prüft die erhaltenen IPs. Der anschließende globale `fetch()` löst denselben Host erneut auf. Die geprüfte Adresse wird nicht an die Verbindung gebunden. Der Code dokumentiert diesen DNS-Rebinding-/TOCTOU-Rest selbst in `lib/security/ssrf.ts:221-250`.

Zusätzlich umgeht der Tracking-Resolver den zentralen Guard weiterhin:

```ts
const response = await fetch(url, {
  method: 'HEAD',
  redirect: 'follow',
  signal: AbortSignal.timeout(5000),
})
```

Diese URL stammt aus Newsletter-Inhalt. Startziel und automatische Redirects werden nicht gegen private, Link-local- oder Metadata-Adressen geprüft.

**Impact:** Zugriff aus der Vercel Function auf interne/private Dienste oder Cloud-Metadata; mögliche Datenexfiltration und Seiteneffekte hängen vom erreichbaren Ziel ab.

**Fix:**

- `resolveTrackingUrl` auf `safeFetch` umstellen und Redirects ausschließlich manuell folgen.
- DNS-Auflösung und Verbindung über einen kontrollierten `undici` Dispatcher/Lookup koppeln, der nur eine zuvor geprüfte IP verbindet und Hostname/SNI erhält.
- Alternativ ausgehenden Traffic über einen Egress-Proxy mit Blockade privater, reserved und Metadata-Netze führen.
- Timeout und maximales Response-Volumen zentral in `safeFetch` erzwingen.
- DNS-Rebinding als Integrationstest mit kontrolliertem Resolver ergänzen.

**Mitigation:** Tracking-Auflösung deaktivieren oder Tracker- und Zielhosts eng allowlisten.

**False-Positive-Hinweis:** Erfolgreiches DNS-Rebinding hängt vom Resolver-/Connection-Caching ab. Die direkte `redirect: 'follow'`-Route im Webcrawler ist davon unabhängig und real.

---

## SEC-005 — Dependency-Graph bleibt kritisch verwundbar

**Status:** Verbessert, weiterhin offen  
**Severity:** High  
**Klasse:** CWE-1104 / Supply Chain  
**Orte:**

- `package.json:93`, `108`, `128`, `130-135`
- `pnpm-lock.yaml:246`, `291`, `346`, `5210`, `5451`, `5693`, `6083`
- `package-lock.json:13415`, `14194`, `16217`, `17248`

**Evidenz:**

- `pnpm audit`: 1 critical, 28 high, 19 moderate, 5 low.
- `npm audit`: 1 critical, 10 high, 16 moderate, 3 low.
- pnpm löst `protobufjs@8.7.1` und damit die frühere RCE, enthält aber weiterhin `vitest@4.0.18` mit Critical Advisory.
- npm löst Vitest auf `4.1.2`, enthält aber `protobufjs@7.5.4` mit Critical RCE Advisory.
- Beide Graphen enthalten direkt `sharp@0.34.5`; betroffen sind alle Versionen `<0.35.0`.
- Der npm-Graph enthält zusätzlich das veraltete direkte `next@16.2.3`, während pnpm `16.2.12` auflöst.

**Applicability:**

- Vitest ist nur dann unmittelbar kritisch, wenn UI/API-Server exponiert oder auf Windows im betroffenen Modus betrieben werden. Der normale CLI-Testlauf reduziert den App-Impact.
- Die `protobufjs`-RCE benötigt manipulierte Schema-/Descriptor-Daten. Ein direkter App-Pfad wurde nicht bestätigt.
- Sharp ist hier besonders relevant: öffentliche Image-Transformer akzeptieren eine fremde URL, laden den vollständigen Body und übergeben ihn an `sharp@0.34.5`. Der Advisory nennt die Verarbeitung untrusted input ausdrücklich als betroffen. Es gibt weder Upgrade noch `sharp.block(...)`-Workaround.

**Impact:** je nach Pfad RCE, File Read, Host Confusion, Parser-/WebSocket-DoS, Speichererschöpfung oder Build-/Dev-Server-Kompromittierung.

**Fix:**

- Einen Package Manager/Lockfile festlegen, dann den einen Graph vollständig aktualisieren.
- Vitest auf mindestens 4.1.0, Sharp auf mindestens 0.35.0 und `protobufjs` auf einen gepatchten 7.x-/8.x-Stand bringen.
- Direkte und transitive High-Pfade wie PostCSS, `ws`, `undici`, Vite, `fast-uri` und `linkify-it` gezielt aktualisieren.
- Den Vercel-Crash mit Sharp 0.35.3 isoliert reproduzieren; nicht dauerhaft auf die verwundbare Version zurückrollen.
- Falls das Upgrade kurzfristig blockiert: GIF-, TIFF- und VIPS-Decoder gemäß Sharp-Advisory blockieren und öffentliche Inputfläche begrenzen.

**Mitigation:** Test-/Dev-Server nie öffentlich binden; Image-Inputs begrenzen; untrusted Protobuf-Schemas ausschließen; Audit-Gate für Critical/High blocking machen.

**False-Positive-Hinweis:** Registry-Severity ist nicht automatisch App-Severity. Wegen der realen Sharp-Inputnähe und zweier inkonsistenter Critical-Graphen bleibt die Projektbewertung High.

---

## SEC-006 — Global permissive Supabase-RLS-Policies

**Status:** Gelöst in Code und produktivem Read-Pfad  
**Vorherige Severity:** High  
**Klasse:** CWE-284 / CWE-862  
**Orte:**

- `supabase/migrations/20260801160000_permissive_policies_cleanup.sql:19-53`
- frühere Policies unter anderem in `20260111110000_i18n_translations.sql`, `20260410_analogy_videos.sql`, `20260601000000_assisted_ranking.sql`

**Verifikation:** Die Cleanup-Migration droppt die neun globalen `FOR ALL`-Policies sowie drei unnötige `subscribers`-Policies und aktiviert RLS explizit auf allen betroffenen Tabellen. `ui_translations` behält nur die beabsichtigte öffentliche SELECT-Policy. `service_role` benötigt keine solche Policy, weil es RLS serverseitig bypasst.

Die erweiterte Produktionsprobe über 83 Namen bestätigt:

- 47 nicht-leere interne Tabellen liefern `anon` null Zeilen, `service_role` dagegen Daten.
- `ranking_runs` ist nicht mehr anonym lesbar.
- `analogy_videos`: `anon=0`, `service_role=5`.
- `product_aliases`: `anon=0`, `service_role=6492`.
- `product_identity_events`: `anon=0`, `service_role=6422`.
- 12 nicht-leere öffentliche Content-/Ranking-Tabellen bleiben erwartungsgemäß read-only lesbar.

Der anonyme OpenAPI-Schema-Abruf liefert HTTP 401. Das entspricht der Supabase-Breaking-Change, die diesen Schema-Zugriff seit April 2026 für bestehende Projekte sperrt.

**Restempfehlung:** Regelmäßig `pg_policies` und Tabellen-Grants über den neuen read-only Management-API-/CLI-Zugang exportieren. Neue interne Tabellen bevorzugt in ein nicht exponiertes Schema legen.

**False-Positive-Hinweis:** Der Audit hat absichtlich keine DML in Produktion ausgeführt. Die Kombination aus Cleanup-Migration und produktiv blockiertem Read-Pfad ist starke, aber keine destruktive DML-Verifikation.

---

## SEC-007 — Öffentliche Image-Transformer folgen Redirects und puffern unbegrenzt

**Status:** Offen  
**Severity:** Medium  
**Klasse:** CWE-918 / CWE-400  
**Orte:**

- `app/api/newsletter/cover-image/route.ts:22-77`
- `app/api/newsletter/thumbnail-image/route.ts:16-57`

**Evidenz:** Der initiale Host wird per exaktem Host-/Subdomain-Match geprüft. Danach folgt `fetch(imageUrl)` standardmäßig Redirects, ohne das Ziel erneut zu prüfen. Der vollständige Body wird mit `arrayBuffer()` gepuffert. Es fehlen Fetch-Timeout, Downloadlimit, Content-Type-/Magic-Byte-Prüfung und Rate Limit. Der Cover-Endpoint verarbeitet bis zu 4000×4000 Pixel. `*.vercel-storage.com`, `*.supabase.co` und weitere breite Plattform-Domains sind erlaubt.

Die Route ist zusätzlich ein direkter Exposure-Pfad für SEC-005 (`sharp@0.34.5`).

**Impact:** SSRF über einen kontrollierten Redirect auf einem erlaubten Host sowie Memory-/CPU-/Kosten-DoS durch große oder dekompressionsintensive Dateien.

**Fix:** Zentralen `safeImageFetch` mit pro Hopp geprüfter Host-Allowlist, 5–10s Timeout, Streaming-Byte-Limit, MIME plus Magic Bytes, Sharp-Inputgrenzen, Rate Limit und Cache einführen. Allowlist auf die tatsächlich genutzten exakten Blob-Hosts reduzieren.

**Mitigation:** Endpoints vorübergehend nur für den eigenen Blob-Host zulassen und per Vercel Firewall limitieren.

**False-Positive-Hinweis:** SSRF benötigt einen kontrollierbaren Redirect auf einem erlaubten Host. Resource Exhaustion und verwundbare Bildverarbeitung benötigen diese Zusatzannahme nicht.

---

## SEC-008 — Öffentliche Analytics-Writes bleiben ungedrosselt

**Status:** Offen  
**Severity:** Medium  
**Klasse:** CWE-400 / CWE-770 / Integrity  
**Orte:**

- `app/api/track/event/route.ts:5-56`
- `app/api/track/podcast-play/route.ts:5-48`

**Evidenz:** Beide POST-Endpunkte schreiben mit `createAdminClient()` und damit `service_role`, ohne Rate Limit oder explizite Body-Grenze. `track/event` allowlistet Event-Typen und kürzt einzelne Strings, parst aber vorher den gesamten Body. `podcast-play` dedupliziert nur nach IP-/User-Agent-Hash; der User-Agent ist frei variierbar. `locale` und `postId` sind nicht streng typisiert bzw. validiert.

**Impact:** Analytics-Vergiftung, DB-Wachstum, Function-/Supabase-Kosten und Memory-DoS durch wiederholte große Bodies.

**Fix:** Relaxed Limit pro verifizierter Client-IP plus globales Budget, Zod-Schema, UUID-/Locale-Validation, kleine explizite Body-Obergrenze und DB-seitige Dedupe-/Retention-Regeln. BotID/WAF für automatisierten Missbrauch erwägen.

**Mitigation:** Rohdaten kurz halten, täglich aggregieren und anomale Eventraten alarmieren.

**False-Positive-Hinweis:** Öffentliche Analytics sind beabsichtigt; der Befund betrifft Abuse-Kontrollen, nicht fehlende Nutzer-Authentifizierung.

---

## SEC-009 — Produktive CSP erlaubt `unsafe-inline` und `unsafe-eval`

**Status:** Offen und produktiv bestätigt  
**Severity:** Medium  
**Klasse:** CWE-79 Defense-in-Depth  
**Ort:** `next.config.mjs:60-83`

**Evidenz:** Der produktive Response-Header enthält:

```text
script-src 'self' 'unsafe-inline' 'unsafe-eval' ...
style-src 'self' 'unsafe-inline'
```

Die Next.js-Dokumentation stellt klar, dass `unsafe-eval` nur für Development-Debugging benötigt wird; React und Next.js verwenden es in Produktion standardmäßig nicht. Die App rendert Rich Content und nutzt kontrolliert `dangerouslySetInnerHTML`, wodurch eine starke CSP besonders wertvoll ist.

**Impact:** Eine zukünftige oder unbekannte HTML-/Script-Injection kann leichter zu JavaScript-Ausführung eskalieren, auch im Admin-Kontext derselben Origin.

**Fix:** `unsafe-eval` nur im Development setzen. Für Scripts Nonces plus `strict-dynamic` oder die experimentelle SRI-/Hash-Strategie prüfen. Nonces erzwingen dynamisches Rendering und können ISR/CDN-Caching beeinträchtigen; diese Trade-offs vor dem Rollout messen. Styles getrennt migrieren.

**Mitigation:** Zuerst eine strengere `Content-Security-Policy-Report-Only` ausrollen und Violations sammeln.

**False-Positive-Hinweis:** Kein konkretes Stored-XSS bestätigt. Das Finding bewertet eine erheblich geschwächte Defense-in-Depth-Schicht.

---

## SEC-010 — Gmail Access-/Refresh-Tokens liegen im Klartext in Postgres

**Status:** Offen  
**Severity:** Medium  
**Klasse:** CWE-312  
**Orte:**

- `app/api/gmail/callback/route.ts:65-104`
- Leser unter anderem `lib/webcrawl/processor.ts:466-475`
- vorhandene Kryptografie: `lib/crypto.ts:1-128`

**Evidenz:** Der gehärtete OAuth-Callback speichert `access_token` und `refresh_token` weiterhin direkt in `gmail_tokens`. RLS schützt die Tabelle gegen `anon`, trennt aber einen Service-Role-, Backup- oder privilegierten DB-Leak nicht vom Gmail-Credential-Leak. AES-256-GCM-Helfer mit zufälligem Salt und IV sind im Projekt bereits vorhanden, werden hier aber nicht genutzt.

**Impact:** dauerhafter Gmail-Zugriff im Umfang `gmail.readonly` und `gmail.modify`; Ingestion kann gelesen, vergiftet oder lahmgelegt werden.

**Fix:** Refresh-Token mit getrennt verwaltetem KMS-/Application-Key verschlüsseln, Access-Token nach Möglichkeit nicht persistieren, bestehende Zeile migrieren, Google-Token rotieren und Key-Versionierung/Rotation vorsehen. Supabase Vault oder ein privates Schema mit restriktiven Funktionen sind Alternativen.

**Mitigation:** Service-Role- und OAuth-Token rotieren; DB-/Backup-Zugriffe auditieren; Token-Revoke-Runbook dokumentieren.

**False-Positive-Hinweis:** Infrastrukturverschlüsselung at rest ist nicht dasselbe wie anwendungsseitige Trennung der beiden Credential-Domänen.

---

## SEC-011 — Security Startup Checks werden nicht ausgeführt

**Status:** Offen  
**Severity:** Low  
**Klasse:** CWE-16 / Security Misconfiguration  
**Orte:**

- `lib/security/startup-checks.ts:18-89`
- `lib/security/index.ts:12-13`
- `lib/rate-limit.ts:9-16`, `65-90`

**Evidenz:** `enforceSecurityConfig()` wird nur exportiert; es gibt keinen Runtime-Aufruf. Die Prüfung kennt nur `UPSTASH_*`, während der Runtime-Code auch die Vercel-Variablen `KV_REST_API_*` akzeptiert. Die Warnung behauptet außerdem noch einen Development-Cron-Bypass, der entfernt wurde.

**Impact:** fehlende oder falsch benannte Secrets werden nicht fail-fast beim Start erkannt; Dokumentation und Runtime driften auseinander.

**Fix:** In `instrumentation.ts`/`register()` oder garantiertem Server-Bootstrap aufrufen, `KV_*` berücksichtigen, JWT-Mindestlänge und alle tatsächlich benötigten Production-Variablen prüfen. Nur Namen/Status loggen.

**Mitigation:** Deployment-Smoke-Test für erforderliche Variablen und negative Auth-Pfade.

**False-Positive-Hinweis:** Einzelne Module prüfen Secrets bei Benutzung. Das Finding betrifft das behauptete zentrale Fail-Fast-Verhalten.

---

## SEC-012 — Zwei Lockfiles und nicht-blockierende Security-Gates

**Status:** Offen  
**Severity:** Medium  
**Klasse:** CWE-1104 / CI Integrity  
**Orte:**

- `package.json:5-14`, `93`, `108`, `128-135`
- `package-lock.json`
- `pnpm-lock.yaml`
- `.github/workflows/security.yml:14-46`, `88-105`, `107-145`

**Evidenz:**

- Beide Lockfiles sind getrackt und lösen verschiedene Security-Zustände auf.
- `package.json` fordert Next `^16.2.12`; der Root-Eintrag in `package-lock.json` steht noch auf `^16.2.3` und löst Next 16.2.3 auf.
- pnpm-Overrides reparieren `protobufjs`; npm sieht diese Overrides nicht und installiert die kritische 7.5.4.
- Dependency-Audit/Installation läuft in CI mit pnpm, Typecheck und Tests dagegen mit `npm ci`.
- `pnpm audit` ist `continue-on-error: true`; Semgrep endet mit `|| true`.
- TruffleHog nutzt `@main`, das Semgrep-Container-Image einen beweglichen Tag.
- `prebuild` ruft `npx tsx` auf, obwohl `tsx` nicht deklariert ist. `pnpm exec tsx` scheitert lokal; der Build kann dadurch unpinned Code aus der Registry nachladen.
- Die Security-Suite enthält noch den positiven Test für den entfernten Cron-Bypass.

**Impact:** Audit, Test, Build und Deployment können verschiedene Graphen prüfen. Kritische Findings blockieren Merges nicht; ein Build-Time-Download umgeht Lockfile und Review.

**Fix:**

- pnpm als einzigen Package Manager über `packageManager`/Corepack festlegen und den npm-Lockfile entfernen – oder konsequent vollständig auf npm wechseln.
- Alle CI-Jobs mit demselben frozen Lockfile installieren.
- `tsx` als Dev Dependency deklarieren und Scripts ohne nachladendes `npx` ausführen.
- High/Critical Audit und Semgrep-ERROR blocking machen.
- Actions auf Commit-SHAs, Container auf Digest und Node-Version auf Production pinnen.
- Security-Regressionstests reparieren und in einen blocking Job verschieben.

**Mitigation:** Bis zur Konsolidierung Install-Command und Lockfile im Vercel-Projekt explizit festlegen.

**False-Positive-Hinweis:** Vercel kann durch Projekteinstellungen einen Graph festlegen. Die CI- und Repository-Drift ist unabhängig davon real und durch die unterschiedlichen Audit-Ergebnisse belegt.

---

## SEC-013 — Öffentliche Podcast-Generierung existiert weiterhin im Reader-GET

**Status:** Offen  
**Severity:** Medium  
**Klasse:** CWE-400 / Business Logic Abuse  
**Orte:**

- `app/api/podcast/[postId]/route.ts:116-207`, `246-350`
- geschützt, aber nicht der Reader-Pfad: `app/api/podcast/generate/route.ts:47-50`

**Evidenz:** `/api/podcast/generate` und `POST /api/podcast/[postId]` verlangen jetzt Admin-Auth. Der produktrelevante Reader-Pfad bleibt jedoch bewusst öffentlich:

```ts
const shouldGenerate = searchParams.get('generate') === 'true'
if (shouldGenerate) {
  await checkRateLimit(`podcast-generate:${getClientIP(request)}`, rateLimiters.strict() ?? undefined)
}
...
generatePodcastForPost(postId, locale)
```

Das Limit beträgt 5 Requests/Minute/IP. `locale` ist frei und Teil des Upsert-Schlüssels. Der Post wird nur per ID geladen; ein `status='published'`-Check fehlt. Bei transientem Upstash-Fehler fällt `checkRateLimit` offen durch.

**Impact:** Verteilte Requests können LLM-/TTS-Arbeit, Blob-Uploads und DB-Einträge erzeugen; beliebige Locale-Varianten erweitern Kosten- und Datenfläche. Nicht veröffentlichte Posts können bei bekannter UUID verarbeitet werden.

**Fix:** Reader nur vorhandene, vorproduzierte Podcasts lesen lassen; Generation admin-/cron-seitig ausführen. Falls On-Demand Produktanforderung bleibt: Published-Post-Check, aktive Locale-Allowlist, globale Tages-/Kostenbudgets, durable Deduplizierung/Lease, BotID und Fail-closed für den teuren Pfad.

**Mitigation:** `generate=true` am Edge blockieren oder nur mit kurzlebigem signiertem Reader-Intent akzeptieren.

**False-Positive-Hinweis:** Die öffentliche Generation ist eine dokumentierte Produktentscheidung und IP-rate-limitiert. Der Befund bewertet die verbleibende Kosten- und Variantenfläche.

---

## SEC-014 — Cache-Secret wird aus dem Service-Role-Key abgeleitet und in der URL übertragen

**Status:** Offen  
**Severity:** Low  
**Klasse:** CWE-598 / CWE-522  
**Ort:** `app/api/revalidate-rankings/route.ts:4-17`

**Evidenz:** Der Endpoint erwartet als `?secret=` die letzten 16 Zeichen von `SUPABASE_SERVICE_ROLE_KEY` und nutzt normalen Stringvergleich. Query-Parameter landen häufig in Request-Logs, APM, History oder Debug-Ausgaben.

**Impact:** Leak erlaubt Cache-Invalidierung und koppelt ein öffentlich benutztes Secret unnötig an einen hochprivilegierten Datenbank-Key.

**Fix:** unabhängiges `REVALIDATE_SECRET`, ausschließlich Bearer Header, timing-safe Vergleich und Rate Limit; bevorzugt in bestehende Admin-/Cron-Auth integrieren.

**Mitigation:** Query-Parameter in Logs redaktieren und Secret nach Umstellung rotieren.

**False-Positive-Hinweis:** Die 16 Zeichen offenbaren nicht den vollständigen Service-Role-Key. Der direkte Impact bleibt Cache-Invalidierung.

---

## SEC-015 — Admin-Sessions sind sieben Tage stateless und nicht widerrufbar

**Status:** Offen  
**Severity:** Low  
**Klasse:** CWE-613  
**Orte:**

- `lib/auth/session.ts:6-91`, `126-177`
- `middleware.ts:33-47`, `164-202`

**Evidenz:** Positiv sind HS256, Secret-Mindestlänge, `exp`/`iat` und ein `HttpOnly`, produktiv `Secure`, `SameSite=Lax` Cookie. Der Token gilt sieben Tage, enthält kein `jti`, keine Session-Version und kein `issuer`/`audience`; ein Revocation-Store fehlt. Middleware und `isAdminRequest` validieren Signatur/Expiry, prüfen aber den `isAdmin`-Claim nicht explizit.

**Impact:** Ein gestohlener Admin-Cookie bleibt bis Ablauf oder Rotation des globalen JWT-Secrets gültig.

**Fix:** kürzere Access-Session, rotierendes Refresh-/Session-Modell, `jti` oder `session_version`, serverseitige Revocation, explizite `issuer`/`audience`/Algorithmus-/`isAdmin`-Prüfung und Re-Auth für kritische Aktionen.

**Mitigation:** JWT-Secret-Rotation und Incident-Runbook dokumentieren; Cookies und Authorization Header in Telemetrie redaktieren.

**False-Positive-Hinweis:** Session-Hardening; kein konkreter Cookie-Diebstahlspfad wurde bestätigt.

---

## Positive Kontrollen

- `/admin` und `/api/admin` sind zentral geschützt; alle geprüften Admin-Route-Handler enthalten zusätzlich einen lokalen Auth-Check.
- Session-Cookie: `HttpOnly`, in Produktion `Secure`, `SameSite=Lax`.
- Passwort- und zentrale Cron-Bearer-Vergleiche nutzen `timingSafeEqual`.
- Produktionsmodus ohne Redis fällt bei Endpoints, die `checkRateLimit` verwenden, geschlossen auf 429 zurück; nur transiente Redis-Fehler fallen offen durch.
- Resend-Webhook prüft die Svix-Signatur auf dem Raw Body.
- Produktiv aktiv: HSTS, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, restriktive Permissions Policy und `poweredByHeader: false`.
- OAuth-`state` ist in beiden Flows implementiert und produktiv negativ verifiziert.
- `safeFetch` validiert Redirect-Hops manuell; IPv6-Regressionstests sind umfangreich.
- Die RLS-Cleanup-Migration ist produktiv sichtbar wirksam.
- `service_role` bleibt serverseitig gekapselt; kein hartcodierter Produktivschlüssel wurde bestätigt.
- TypeScript-Check besteht; 373 Tests bestehen.
- Vercel CLI ist bereits auf 58.4.4 aktualisiert; kein Upgrade-Schritt mehr nötig.

## Nicht bestätigte Risiken

- Kein bestätigter SQL-Injection-Pfad; Supabase Query Builder/RPC-Parameter werden überwiegend strukturiert verwendet.
- Kein bestätigtes Open Redirect in den geprüften OAuth-/Newsletter-Flows.
- Kein bestätigtes Stored XSS. TipTap-Text wird strukturiert gerendert, JSON-LD escapt `<`, und Admin-Promo-HTML nutzt `sanitize-html`. Die CSP bleibt wegen SEC-009 trotzdem zu schwach.
- Keine hartcodierten Produktiv-Secrets im aktuellen Workspace oder in der geprüften Git-History-Heuristik.
- Kein verbleibender `x-vercel-cron`-Runtime-Bypass bestätigt.
- Keine Server Actions gefunden; Mutationen liegen in Route Handlern.

## Grenzen des Audits

- Die Supabase CLI ist lokal 2.75.0 und ohne `SUPABASE_ACCESS_TOKEN`; `db advisors`, `migration list --linked`, `pg_policies` und Grants konnten nicht direkt per Management-Zugang abgefragt werden.
- Supabase-Produktionsproben waren absichtlich read-only. Anonyme DML-Rechte wurden nicht durch echte INSERT/UPDATE/DELETE-Operationen getestet.
- Supabase sperrt den OpenAPI-Schemaabruf per anon-Key seit April 2026; der erwartete HTTP-401 verhindert diese zusätzliche read-only Privilegienprüfung.
- 21 Tests benötigen externes Netzwerk oder Produktionsdatenbank und scheiterten in der Sandbox; nur der Cron-Test ist eine lokale, reproduzierbare Regression.
- Semgrep, TruffleHog, Gitleaks und OSV-Scanner waren lokal nicht installiert. Der Report stützt sich ergänzend auf Repository-CI-Konfiguration, Heuristiken sowie npm-/pnpm-Advisories.
- Der Workspace enthält umfangreiche bestehende untracked Dateien. Sie wurden beim Secret-/Code-Scan berücksichtigt, aber nicht verändert.
- Externe APIs und Vercel-Funktionen wurden nicht offensiv oder mit fremden Daten getestet.

## Empfohlene Regressionstests

1. Subscribe liefert für neue und bestehende Adressen weder `sid` noch unterscheidbare Account-Metadaten.
2. Preference-Token kann nur serverintern oder nach E-Mail-Besitznachweis erstellt werden.
3. Rohe Subscriber-UUID autorisiert weder Preferences, Set-Language, Unsubscribe noch Referral-Stats.
4. `x-vercel-cron: 1` ohne Bearer-Secret ergibt 401 für jede Cron-Route.
5. OAuth-Callback ohne, mit falschem, abgelaufenem oder wiederverwendetem `state` wird abgelehnt.
6. SSRF-Tests ergänzen Redirect aus Tracking-Link auf private IP und DNS-Rebinding mit kontrolliertem Resolver.
7. Image-Proxy bricht bei externem Redirect, Timeout, falschem MIME, zu großem Body und Decoder-Bomb ab.
8. SQL-/Management-Test prüft jede exponierte Tabelle auf effektive anon SELECT-/DML-Privilegien.
9. Dependency-Gate schlägt bei Critical/High Advisories außerhalb einer begründeten, ablaufenden Allowlist fehl.
10. Reader-Podcast-Generation akzeptiert nur veröffentlichte Posts und aktive Locales und respektiert ein globales Kostenbudget.
11. Analytics lehnt übergroße Bodies, ungültige UUIDs/Locales und hohe Request-Raten ab.
12. CSP-E2E-Test bestätigt, dass Produktion ohne `unsafe-eval` funktioniert.

## Referenzen

- [Vercel: Managing Cron Jobs / CRON_SECRET](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
- [Google: OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Next.js: Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Changelog: OpenAPI-Schema nicht mehr über anon-Key](https://supabase.com/changelog/42949-breaking-change-removing-access-to-openapi-spec-via-the-anon-key)
- [Supabase Changelog: Developer Update May 2026](https://supabase.com/changelog/45702-developer-update-may-2026)
- [GitHub Advisory: protobufjs RCE](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)
- [GitHub Advisory: Vitest UI](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
- [GitHub Advisory: Sharp/libvips](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
