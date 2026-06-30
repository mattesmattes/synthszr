import { Suspense } from 'react'
import { getReferralStats } from '@/lib/referrals/service'
import { ReferralShare } from '@/components/referral-share'
import { SiteFooter } from '@/components/site-footer'
import { BloomLanguageSwitcher } from '@/components/bloom-language-switcher'
import { ReferralSidFallback } from '@/components/referral-sid-fallback'
import { ReferralEmailGate } from '@/components/referral-email-gate'
import type { LanguageCode } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Code-Crash-Cover + Link aus dem Ad-Promo "Code Crash Q3" (Sommer-Edition).
const CC_COVER = 'https://lbrzdn804nhy3kox.public.blob.vercel-storage.com/ad-promos/9f56a5f4-d643-4747-8e8d-0686efbf7017-left-1781417692331-buch_cover_synthszr.png'
const CC_URL = 'https://codecrash.ai/de'

const TEXT = {
  de: {
    title: 'Teile Synthszr',
    sub: 'Du magst synthszr? Dann teil es mit den richtigen Freunden, Kolleg:innen und für wen es sonst noch interessant sein könnte. 1.000 Dank ❤️!',
    count: 'Bestätigte Empfehlungen',
    remaining: (n: number) => `Nur noch ${n} bis zu deinem signierten CODE CRASH-Hardcover 🎁`,
    reward: 'Bei 10 bestätigten Empfehlungen schicke ich dir CODE CRASH als Hardcover zu — mit echter persönlicher Widmung, ganz ohne KI 😉',
    rewardDone: '🎉 Geschafft! Dein signiertes CODE CRASH-Hardcover ist freigeschaltet — wir melden uns für den Versand.',
    confirmed: 'Bestätigt',
    pending: 'Ausstehend',
    empty: 'Noch keine Empfehlungen — teile deinen Link!',
    invalid: 'Diesen persönlichen Link findest du in jedem Synthszr-Newsletter ganz unten.',
    copy: 'Kopieren',
    copied: 'Kopiert!',
    shareText: 'Ich starte jeden Morgen mit Synthszr — die wichtigsten AI-News in 5 Minuten, klug kuratiert statt Hype-Lärm. 🧠 Schau mal rein, ich glaub, das ist genau dein Ding:',
    gatePrompt: 'Gib deine E-Mail-Adresse ein — wir senden dir den Link zu deiner persönlichen Empfehlungs-Übersicht.',
    gatePlaceholder: 'deine@email.com',
    gateCta: 'Link senden',
    gateSending: 'Wird gesendet…',
    gateSent: 'Wenn diese Adresse abonniert ist, haben wir dir gerade den Link zu deiner Übersicht geschickt. Schau in dein Postfach.',
    ccDesc: 'CODE CRASH (Sommer-Edition, 2. Auflage) ist Matthias Schraders Buch über den Umbruch, den agentische KI in Wirtschaft, Software und Führung auslöst. Es spannt den Bogen von Produktentwicklung über Unternehmensaufstellung bis zur Kultur im KI-Zeitalter — mit einem überraschend optimistischen Ausblick auf den Standort Deutschland.',
    ccCta: 'Mehr zum Buch →',
  },
  en: {
    title: 'Share Synthszr',
    sub: 'Love synthszr? Then share it with the right friends, colleagues, and anyone else who might find it interesting. A thousand thanks ❤️!',
    count: 'Confirmed referrals',
    remaining: (n: number) => `Just ${n} more to unlock your signed CODE CRASH hardcover 🎁`,
    reward: "Reach 10 confirmed referrals and I'll send you CODE CRASH as a hardcover — with a real personal dedication, no AI involved 😉",
    rewardDone: '🎉 Done! Your signed CODE CRASH hardcover is unlocked — we will reach out about shipping.',
    confirmed: 'Confirmed',
    pending: 'Pending',
    empty: 'No referrals yet — share your link!',
    invalid: 'You can find your personal link at the bottom of every Synthszr newsletter.',
    copy: 'Copy',
    copied: 'Copied!',
    shareText: "I start every morning with Synthszr — the most important AI news in 5 minutes, smartly curated instead of hype noise. 🧠 Take a look, I think it's exactly your thing:",
    gatePrompt: "Enter your email — we'll send you the link to your personal referral overview.",
    gatePlaceholder: 'you@email.com',
    gateCta: 'Send link',
    gateSending: 'Sending…',
    gateSent: 'If this address is subscribed, we just sent you the link to your overview. Check your inbox.',
    ccDesc: "CODE CRASH (Summer Edition, 2nd edition) is Matthias Schrader's book on the upheaval agentic AI brings to business, software, and leadership. It spans product development, org design, and culture in the AI age — with a surprisingly optimistic outlook for Germany.",
    ccCta: 'More about the book →',
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

            {/* Belohnung: CODE CRASH (Hardcover mit Widmung) */}
            <div className="rounded-2xl border border-border p-6 flex gap-5 items-start">
              <a href={CC_URL} target="_blank" rel="noopener noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={CC_COVER} alt="CODE CRASH" className="w-32 h-auto rounded-md shadow-sm" />
              </a>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">{L.ccDesc}</p>
                <a href={CC_URL} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-accent hover:underline">
                  {L.ccCta}
                </a>
              </div>
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
      <SiteFooter locale={lang} showNewsletter={false} />
    </>
  )
}
