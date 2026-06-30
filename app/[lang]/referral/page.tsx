import { Suspense } from 'react'
import { getReferralStats } from '@/lib/referrals/service'
import { ReferralShare } from '@/components/referral-share'
import { SiteFooter } from '@/components/site-footer'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { ReferralSidFallback } from '@/components/referral-sid-fallback'
import { ReferralEmailGate } from '@/components/referral-email-gate'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

const TEXT = {
  de: {
    title: 'Teile Synthszr',
    sub: 'Teile deinen persönlichen Empfehlungslink — pro bestätigter Anmeldung steigt dein Zähler.',
    count: 'Bestätigte Empfehlungen',
    remaining: (n: number) => `Noch ${n} bis zu deinem CODE CRASH-Exemplar`,
    reward: 'Bei 10 bestätigten Empfehlungen schenken wir dir das Buch CODE CRASH.',
    rewardDone: '🎉 Geschafft! Dein CODE CRASH-Exemplar ist freigeschaltet — wir melden uns für den Versand.',
    confirmed: 'Bestätigt',
    pending: 'Ausstehend',
    empty: 'Noch keine Empfehlungen — teile deinen Link!',
    invalid: 'Diesen persönlichen Link findest du in jedem Synthszr-Newsletter ganz unten.',
    copy: 'Kopieren',
    copied: 'Kopiert!',
    shareText: 'Ich lese Synthszr — täglich die wichtigsten AI-News, kompakt aufbereitet. Schau rein:',
    gatePrompt: 'Gib deine E-Mail-Adresse ein — wir senden dir den Link zu deiner persönlichen Empfehlungs-Übersicht.',
    gatePlaceholder: 'deine@email.com',
    gateCta: 'Link senden',
    gateSending: 'Wird gesendet…',
    gateSent: 'Wenn diese Adresse abonniert ist, haben wir dir gerade den Link zu deiner Übersicht geschickt. Schau in dein Postfach.',
  },
  en: {
    title: 'Share Synthszr',
    sub: 'Share your personal referral link — every confirmed signup raises your count.',
    count: 'Confirmed referrals',
    remaining: (n: number) => `${n} more to unlock your CODE CRASH copy`,
    reward: 'Reach 10 confirmed referrals and we gift you the book CODE CRASH.',
    rewardDone: '🎉 Done! Your CODE CRASH copy is unlocked — we will reach out about shipping.',
    confirmed: 'Confirmed',
    pending: 'Pending',
    empty: 'No referrals yet — share your link!',
    invalid: 'You can find your personal link at the bottom of every Synthszr newsletter.',
    copy: 'Copy',
    copied: 'Copied!',
    shareText: 'I read Synthszr — the most important AI news daily, neatly digested. Check it out:',
    gatePrompt: "Enter your email — we'll send you the link to your personal referral overview.",
    gatePlaceholder: 'you@email.com',
    gateCta: 'Send link',
    gateSending: 'Sending…',
    gateSent: 'If this address is subscribed, we just sent you the link to your overview. Check your inbox.',
  },
}

export default async function ReferralPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ sid?: string }>
}) {
  const { lang } = await params
  const { sid } = await searchParams
  const L = lang === 'de' ? TEXT.de : TEXT.en
  const stats = sid ? await getReferralStats(sid) : null

  const pct = stats ? Math.min(100, Math.round((stats.confirmedCount / stats.threshold) * 100)) : 0
  const remaining = stats ? Math.max(0, stats.threshold - stats.confirmedCount) : 0

  return (
    <>
      <main className="max-w-2xl mx-auto px-4 py-10">
        <Suspense fallback={null}>
          <BloomLanguageSwitcher currentLocale={lang as LanguageCode} />
        </Suspense>

        <h1 className="text-3xl font-bold tracking-tight">{L.title}</h1>
        <p className="mt-2 text-muted-foreground">{L.sub}</p>

        {!stats ? (
          <>
            <ReferralSidFallback />
            <ReferralEmailGate
              lang={lang}
              labels={{ prompt: L.gatePrompt, placeholder: L.gatePlaceholder, cta: L.gateCta, sending: L.gateSending, sent: L.gateSent }}
            />
          </>
        ) : (
          <div className="mt-8 space-y-8">
            <ReferralShare url={stats.referralUrl} shareText={L.shareText} copyLabel={L.copy} copiedLabel={L.copied} />

            {/* Zähler + Fortschritt zur Belohnung */}
            <div className="rounded-2xl border border-border p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">{L.count}</span>
                <span className="text-4xl font-bold tabular-nums">{stats.confirmedCount}</span>
              </div>
              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-3 text-sm font-medium">
                {stats.rewarded ? L.rewardDone : remaining > 0 ? L.remaining(remaining) : L.rewardDone}
              </p>
              {!stats.rewarded && <p className="mt-1 text-xs text-muted-foreground">{L.reward}</p>}
            </div>

            {/* Listen: bestätigt / ausstehend */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              {([['confirmed', stats.confirmed], ['pending', stats.pending]] as const).map(([key, entries]) => (
                <div key={key}>
                  <h2 className="text-sm font-semibold">
                    {key === 'confirmed' ? L.confirmed : L.pending}{' '}
                    <span className="text-muted-foreground">({entries.length})</span>
                  </h2>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {entries.length === 0 ? (
                      <li className="text-xs">{L.empty}</li>
                    ) : (
                      entries.map((e, i) => (
                        <li key={i} className="flex justify-between gap-2 border-b border-border/50 py-1">
                          <span className="truncate">{e.emailMasked}</span>
                          <span className="shrink-0 tabular-nums text-xs">{e.date?.slice(0, 10)}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      <SiteFooter locale={lang} />
    </>
  )
}
