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
    title: 'Empfehle synthszr',
    sub: 'Du magst synthszr? Dann empfehle den Newsletter Freunden, Kollegen und für wen es sonst noch interessant sein könnte. Würde mich sehr freuen ❤️!',
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
    title: 'Recommend synthszr',
    sub: 'Like synthszr? Then recommend the newsletter to friends, colleagues, and anyone else who might find it interesting. Would really appreciate it ❤️!',
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
  fr: {
    title: 'Recommande synthszr',
    sub: 'Tu aimes synthszr ? Alors recommande la newsletter à tes amis, tes collègues et à toute personne que cela pourrait intéresser. Ça me ferait très plaisir ❤️ !',
    count: 'Recommandations confirmées',
    remaining: (n: number) => `Plus que ${n} avant ton exemplaire relié dédicacé de CODE CRASH 🎁`,
    reward: 'À 10 recommandations confirmées, je t’envoie CODE CRASH en édition reliée — avec une vraie dédicace personnelle, sans IA 😉',
    rewardDone: '🎉 C’est fait ! Ton exemplaire relié signé de CODE CRASH est débloqué — nous te contacterons pour l’envoi.',
    confirmed: 'Confirmées',
    pending: 'En attente',
    empty: 'Encore aucune recommandation — partage ton lien !',
    invalid: 'Tu trouves ton lien personnel tout en bas de chaque newsletter Synthszr.',
    copy: 'Copier',
    copied: 'Copié !',
    shareText: 'Je commence chaque matin avec Synthszr — l’essentiel de l’actu IA en 5 minutes, intelligemment sélectionné plutôt que du bruit. 🧠 Jette un œil, je pense que c’est exactement ton truc :',
    gatePrompt: 'Saisis ton e-mail — nous t’enverrons le lien vers ton aperçu personnel de recommandations.',
    gatePlaceholder: 'toi@email.com',
    gateCta: 'Envoyer le lien',
    gateSending: 'Envoi…',
    gateSent: 'Si cette adresse est abonnée, nous venons de t’envoyer le lien vers ton aperçu. Vérifie ta boîte mail.',
    ccDesc: 'CODE CRASH (édition d’été, 2e édition) est le livre de Matthias Schrader sur le bouleversement que l’IA agentique apporte à l’économie, au logiciel et au management. Il couvre le développement produit, l’organisation des entreprises et la culture à l’ère de l’IA — avec une perspective étonnamment optimiste pour l’Allemagne.',
    ccCta: 'En savoir plus sur le livre →',
  },
  cs: {
    title: 'Doporuč synthszr',
    sub: 'Máš rád synthszr? Doporuč newsletter přátelům, kolegům a všem, koho by mohl zajímat. Moc bych to ocenil ❤️!',
    count: 'Potvrzená doporučení',
    remaining: (n: number) => `Už jen ${n} do tvého podepsaného hardcoveru CODE CRASH 🎁`,
    reward: 'Při 10 potvrzených doporučeních ti pošlu CODE CRASH v pevné vazbě — se skutečným osobním věnováním, bez AI 😉',
    rewardDone: '🎉 Hotovo! Tvůj podepsaný hardcover CODE CRASH je odemčený — ozveme se ohledně zaslání.',
    confirmed: 'Potvrzeno',
    pending: 'Čeká na potvrzení',
    empty: 'Zatím žádná doporučení — sdílej svůj odkaz!',
    invalid: 'Svůj osobní odkaz najdeš dole v každém newsletteru Synthszr.',
    copy: 'Kopírovat',
    copied: 'Zkopírováno!',
    shareText: 'Každé ráno začínám se Synthszr — nejdůležitější AI novinky za 5 minut, chytře vybrané místo hype šumu. 🧠 Mrkni na to, myslím, že je to přesně pro tebe:',
    gatePrompt: 'Zadej svůj e-mail — pošleme ti odkaz na tvůj osobní přehled doporučení.',
    gatePlaceholder: 'tvuj@email.com',
    gateCta: 'Poslat odkaz',
    gateSending: 'Odesílání…',
    gateSent: 'Pokud je tato adresa přihlášená k odběru, právě jsme ti poslali odkaz na tvůj přehled. Zkontroluj schránku.',
    ccDesc: 'CODE CRASH (letní edice, 2. vydání) je kniha Matthiase Schradera o zvratu, který agentní AI přináší do byznysu, softwaru a vedení. Klene oblouk od vývoje produktů přes uspořádání firem až po kulturu v době AI — s překvapivě optimistickým výhledem pro Německo.',
    ccCta: 'Více o knize →',
  },
  nds: {
    title: 'Empfehl synthszr',
    sub: 'Du magst synthszr? Denn empfehl den Newsletter dien Frünnen, Kollegen un för wen dat sünst noch interessant wesen kunn. Wöör mi bannig freuen ❤️!',
    count: 'Bestätigte Empfehlungen',
    remaining: (n: number) => `Bloots noch ${n} bet to dien signeerte CODE CRASH-Hardcover 🎁`,
    reward: 'Bi 10 bestätigte Empfehlungen schick ik di CODE CRASH as Hardcover to — mit en echte persöönliche Widmen, ganz ahn KI 😉',
    rewardDone: '🎉 Schafft! Dien signeerte CODE CRASH-Hardcover is free — wi mellt uns för’n Versand.',
    confirmed: 'Bestätigt',
    pending: 'Noch nich bestätigt',
    empty: 'Noch keen Empfehlungen — deel dien Link!',
    invalid: 'Dien persöönlichen Link finnst du in elk Synthszr-Newsletter ganz nerrn.',
    copy: 'Koperen',
    copied: 'Kopeert!',
    shareText: 'Ik fang elken Morgen mit Synthszr an — de wichtigsten AI-Narichten in 5 Minuten, klook utsöcht statt Hype-Krach. 🧠 Kiek mal rin, ik glööv, dat is akkerat dien Ding:',
    gatePrompt: 'Giff dien E-Mail-Adress in — wi sendt di den Link to dien persöönliche Empfehlungs-Översicht.',
    gatePlaceholder: 'dien@email.com',
    gateCta: 'Link sennen',
    gateSending: 'Warrt sendt…',
    gateSent: 'Wenn disse Adress afonneert is, hebbt wi di jüst den Link to dien Översicht sendt. Kiek in dien Postfach.',
    ccDesc: 'CODE CRASH (Sommer-Edition, 2. Uplaag) is Matthias Schrader sien Book över den Ümbruch, den agentische KI in Wirtschaft, Software un Föhren utlööst. Dat spannt den Bagen vun Produktentwicklung över Ünnernehmen-Opstellung bet to de Kultur in’t KI-Tietöller — mit en överraschend optimistischen Utblick op den Standoort Düütschland.',
    ccCta: 'Mehr to’t Book →',
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
  const L = TEXT[lang as keyof typeof TEXT] ?? TEXT.en
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
