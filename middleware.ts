import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { createClient } from '@supabase/supabase-js'

const SESSION_COOKIE_NAME = 'synthszr_session'
const LOCALE_COOKIE_NAME = 'synthszr_locale'

// All potentially supported locales
const ALL_LOCALES = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'nds'] as const
type LocaleType = (typeof ALL_LOCALES)[number]

const DEFAULT_LOCALE: LocaleType = 'de'

// Routes that require authentication
const protectedRoutes = ['/admin', '/api/admin']

// Routes that should redirect to admin if already logged in
const authRoutes = ['/login']

// Routes that should NOT have locale prefix (static, api, admin, etc.)
const NON_LOCALIZED_PREFIXES = ['/api', '/admin', '/login', '/_next', '/favicon', '/docs', '/newsletter']

// Cache for active languages (refreshed every 5 minutes)
let activeLanguagesCache: Set<string> | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getSecretKey() {
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD
  if (!secret) {
    throw new Error('JWT_SECRET or ADMIN_PASSWORD environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecretKey())
    return true
  } catch {
    return false
  }
}

/**
 * Fetches active languages from database
 */
async function getActiveLanguages(): Promise<Set<string>> {
  const now = Date.now()

  // Return cached if still valid
  if (activeLanguagesCache && now - cacheTimestamp < CACHE_TTL) {
    return activeLanguagesCache
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      // Fallback: only default locale
      return new Set([DEFAULT_LOCALE])
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data, error } = await supabase
      .from('languages')
      .select('code')
      .eq('is_active', true)

    if (error || !data) {
      console.error('Error fetching active languages:', error)
      return new Set([DEFAULT_LOCALE])
    }

    activeLanguagesCache = new Set(data.map(l => l.code))
    cacheTimestamp = now

    return activeLanguagesCache
  } catch (error) {
    console.error('Error in getActiveLanguages:', error)
    return new Set([DEFAULT_LOCALE])
  }
}

/**
 * Extract locale from pathname
 */
function getLocaleFromPathname(pathname: string): LocaleType | null {
  const segments = pathname.split('/')
  const potentialLocale = segments[1]

  if (ALL_LOCALES.includes(potentialLocale as LocaleType)) {
    return potentialLocale as LocaleType
  }

  return null
}

// Plattdeutsch-speaking regions for NDS locale detection
// Ostfriesland is in Niedersachsen (NI), Nordfriesland is in Schleswig-Holstein (SH)
const OSTFRIESLAND_CITIES = new Set([
  'Aurich', 'Emden', 'Leer', 'Norden', 'Wittmund', 'Borkum', 'Norderney',
  'Juist', 'Baltrum', 'Langeoog', 'Spiekeroog', 'Wangerooge', 'Esens',
  'Weener', 'Rhauderfehn', 'Moormerland', 'Großefehn', 'Ihlow', 'Krummhörn',
  'Georgsheil', 'Upgant-Schott', 'Südbrookmerland', 'Wiesmoor',
])
const NORDFRIESLAND_CITIES = new Set([
  'Husum', 'Niebüll', 'Tönning', 'Wyk auf Föhr', 'List auf Sylt', 'Westerland',
  'Sylt', 'Föhr', 'Amrum', 'Pellworm', 'Helgoland', 'Bredstedt', 'Garding',
  'Friedrichstadt', 'St. Peter-Ording', 'Sankt Peter-Ording', 'Leck', 'Süderlügum',
])

// Explicit country → locale mapping. Anything not listed defaults to DE.
// Only active locales: de, en, cs, nds
const COUNTRY_LOCALE_MAP: Record<string, LocaleType> = {
  // English-speaking
  GB: 'en',
  US: 'en',
  // Czech Republic
  CZ: 'cs',
}

/**
 * Detect locale from Vercel geo headers.
 * Default behavior: DE for any country not explicitly mapped.
 * EN is only returned for US/UK visitors. CS only for CZ. NDS for
 * Plattdeutsch-speaking regions (Ostfriesland + Nordfriesland).
 */
function detectLocaleFromGeo(request: NextRequest, activeLanguages: Set<string>): LocaleType | null {
  const country = request.headers.get('x-vercel-ip-country') || ''
  const region = request.headers.get('x-vercel-ip-country-region') || ''
  const rawCity = request.headers.get('x-vercel-ip-city') || ''
  const city = decodeURIComponent(rawCity)

  let detected: LocaleType

  if (country === 'DE') {
    // Plattdeutsch regions: Ostfriesland (NI) + Nordfriesland (SH)
    if (region === 'NI' && OSTFRIESLAND_CITIES.has(city)) {
      detected = 'nds'
    } else if (region === 'SH' && NORDFRIESLAND_CITIES.has(city)) {
      detected = 'nds'
    } else {
      detected = 'de'
    }
  } else {
    // Explicit map → fall back to DE for everything else
    detected = COUNTRY_LOCALE_MAP[country] ?? 'de'
  }

  // Only return if the locale is active in the DB
  if (activeLanguages.has(detected)) return detected
  return DEFAULT_LOCALE
}

/**
 * Check if path should be localized
 */
function shouldLocalize(pathname: string): boolean {
  // Exclude static file requests (catches anything the matcher regex missed)
  if (/\.(?:png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|css|js|json|xml|txt|mp3|mp4|wav|ogg|webm|m4a)$/i.test(pathname)) {
    return false
  }
  return !NON_LOCALIZED_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value

  // ========================================
  // AUTH HANDLING (admin routes + API routes)
  // ========================================
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route))
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route))

  if (isProtectedRoute || isAuthRoute) {
    const isAuthenticated = sessionToken ? await verifyToken(sessionToken) : false

    if (isProtectedRoute && !isAuthenticated) {
      // Allow cron-authenticated API requests to pass through to route handler
      if (pathname.startsWith('/api/')) {
        const authHeader = request.headers.get('authorization')
        const cronSecret = process.env.CRON_SECRET
        const isCronAuth =
          (cronSecret && authHeader === `Bearer ${cronSecret}`) ||
          request.headers.get('x-vercel-cron') === '1'
        if (isCronAuth) return NextResponse.next()
        return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (isAuthRoute && isAuthenticated) {
      return NextResponse.redirect(new URL('/admin', request.url))
    }

    return NextResponse.next()
  }

  // ========================================
  // i18n HANDLING (public routes)
  // ========================================
  if (!shouldLocalize(pathname)) {
    return NextResponse.next()
  }

  const activeLanguages = await getActiveLanguages()
  const urlLocale = getLocaleFromPathname(pathname)

  // Case 1: URL has a locale prefix
  if (urlLocale) {
    // Check if locale is active
    if (!activeLanguages.has(urlLocale)) {
      // Redirect to default locale (301 permanent)
      const pathWithoutLocale = pathname.replace(`/${urlLocale}`, '') || '/'
      const redirectUrl = new URL(`/${DEFAULT_LOCALE}${pathWithoutLocale}`, request.url)
      // Preserve query parameters (e.g., ?stock=Nvidia from newsletter links)
      redirectUrl.search = request.nextUrl.search
      return NextResponse.redirect(redirectUrl, 301)
    }

    // Locale is active - continue with locale header.
    // Set a cacheable public Cache-Control so Vercel's edge + Google can cache
    // the rendered HTML for 60s (SWR 5min). Without this, the Supabase server
    // client's cookie reads cause Next to emit `private, no-store` — which
    // Google reads as "personalized, don't index".
    const response = NextResponse.next()
    response.headers.set('x-locale', urlLocale)
    response.headers.set('cache-control', 'public, s-maxage=60, stale-while-revalidate=300')
    return response
  }

  // Case 2: URL has no locale prefix - redirect to preferred locale
  // Priority: cookie > geo detection > default
  const cookieLocale = request.cookies.get(LOCALE_COOKIE_NAME)?.value as LocaleType | undefined
  const geoLocale = !cookieLocale ? detectLocaleFromGeo(request, activeLanguages) : null
  const preferredLocale =
    (cookieLocale && activeLanguages.has(cookieLocale) ? cookieLocale : null) ??
    geoLocale ??
    DEFAULT_LOCALE

  // Redirect to localized URL (307 temporary — destination depends on cookie locale)
  const localizedUrl = new URL(`/${preferredLocale}${pathname === '/' ? '' : pathname}`, request.url)
  // Preserve query parameters (e.g., ?stock=Nvidia from newsletter links)
  localizedUrl.search = request.nextUrl.search
  const response = NextResponse.redirect(localizedUrl, 307)
  response.headers.set('x-locale', preferredLocale)
  return response
}

export const config = {
  matcher: [
    // Match all paths except static files and common file extensions
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|apple-touch-icon.*|google.*\\.html|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot|css|js|json|xml|txt|mp3|mp4|wav|ogg|webm|m4a)$).*)',
  ],
}
