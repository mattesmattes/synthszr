import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/security/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPages, evaluateHealth, shouldNotify, type HealthResult } from '@/lib/health/check'
import { checkSharedCache, type CacheHealth } from '@/lib/health/cache-check'
import { buildPageList } from '@/lib/health/pages'
import { getResend, FROM_EMAIL, BASE_URL } from '@/lib/resend/client'

export const maxDuration = 300

const SETTINGS_KEY = 'health_check_last'
const ALERT_TO = 'mattes@gmail.com'

/**
 * Prüft alle vier Stunden, ob die öffentlichen Seiten ausgeliefert werden
 * (vercel.json).
 *
 * ANLASS: Am 2026-08-25 lieferten sämtliche Artikelseiten 500 (ein zu offener
 * pnpm-Override zog nanoid 6 herein, ESM-only, postcss lädt es per require()).
 * Aufgefallen ist es nur, weil der Betreiber zufällig eine URL öffnete.
 *
 * Der Zustand liegt in `settings` unter health_check_last — dieselbe Tabelle,
 * die schon schedule_config und die last_run_*-Marken hält. Damit braucht diese
 * Prüfung keine Migration; Schema-Änderungen gehen hier nur von Hand über das
 * Supabase-Dashboard.
 *
 * IMMER 200, auch wenn Seiten ausfallen: Der Cron hat seine Arbeit getan. Ein
 * roter Cron in Vercel würde nur verdecken, wo das Problem wirklich sitzt.
 */
export async function GET(request: NextRequest) {
  const authResult = verifyCronAuth(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  try {
    const urls = await buildPageList(supabase, BASE_URL)
    const results = await checkPages(urls)
    const pages = evaluateHealth(results)

    // Der geteilte Cache faellt lautlos aus: Der Fallback greift, die Seiten
    // bleiben erreichbar, nur der Supabase-Egress steigt wieder an. Am
    // 28.08.2026 lief das TAGELANG unbemerkt (erschoepftes Upstash-Kontingent),
    // entdeckt wurde es zufaellig. Deshalb zaehlt er hier mit.
    const cache = await checkSharedCache()
    const health: HealthResult & { cache: CacheHealth } = {
      ...pages,
      healthy: pages.healthy && cache.healthy,
      cache,
    }

    const { data: prevRow } = await supabase
      .from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    const previous = (prevRow?.value ?? null) as HealthResult | null

    await supabase.from('settings').upsert({ key: SETTINGS_KEY, value: health }, { onConflict: 'key' })

    let mailed = false
    if (shouldNotify(health, previous)) {
      mailed = await sendAlert(health)
    }

    console.log(`[HealthCheck] ${health.checked} Seiten, ${health.failed.length} Ausfälle, Cache ${cache.healthy ? 'ok' : 'GESTOERT'}${mailed ? ', Mail verschickt' : ''}`)
    return NextResponse.json({ ok: true, healthy: health.healthy, checked: health.checked, failed: health.failed.length, cache, mailed })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unbekannt'
    console.error('[HealthCheck]', error)
    return NextResponse.json({ ok: false, error: message })
  }
}

async function sendAlert(health: HealthResult & { cache?: CacheHealth }): Promise<boolean> {
  try {
    const zeit = new Date(health.checkedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })
    const cacheKaputt = health.cache && !health.cache.healthy
    const betreff = health.healthy
      ? '✅ synthszr.com ist wieder erreichbar'
      : health.failed.length === 0 && cacheKaputt
        ? '🟠 synthszr.com: geteilter Cache gestört'
        : `🔴 synthszr.com: ${health.failed.length} von ${health.checked} Seiten nicht erreichbar`

    const zeilen = health.failed.length
      ? health.failed.map((f) => `<li><code>${f.url}</code> — ${f.error ? `Netzwerkfehler: ${f.error}` : `HTTP ${f.status}`}</li>`).join('')
      : '<li>Alle geprüften Seiten antworten wieder.</li>'

    await getResend().emails.send({
      from: FROM_EMAIL,
      to: ALERT_TO,
      subject: betreff,
      html: `<p>Verfügbarkeitsprüfung vom ${zeit}:</p>
<ul>${zeilen}</ul>
<p>${health.checked} Seiten geprüft, ${health.failed.length} davon nicht erreichbar.</p>
${cacheKaputt ? `<p><strong>Geteilter Cache gestört:</strong> ${health.cache!.error}</p><p style="color:#666;font-size:13px">Die Seiten funktionieren trotzdem — der Cache fällt auf die Datenbank zurück. Es steigt aber der Supabase-Egress, gegen den dieser Cache gebaut wurde.</p>` : ''}
<p style="color:#666;font-size:13px">Diese Mail kommt nur bei einem Zustandswechsel — also wenn ein Ausfall beginnt oder endet, nicht alle vier Stunden erneut.</p>`,
    })
    return true
  } catch (err) {
    // Ein fehlgeschlagener Mailversand darf die Prüfung nicht mitreißen: der
    // Zustand ist oben schon gespeichert und im Admin sichtbar.
    console.error('[HealthCheck] Mailversand fehlgeschlagen:', err)
    return false
  }
}
