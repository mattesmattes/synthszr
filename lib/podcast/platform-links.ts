// lib/podcast/platform-links.ts
// Single source of truth for the Synthszr podcast platform links + icons.
// Show-level (not per-episode) — used by web badges, email HTML, and the
// podcast tip-promo.
//
// DREI BILDFASSUNGEN, DREI ZWECKE — nicht durcheinanderbringen:
//
//   image       SVG, offizielles Herstellerasset. NUR fuers Web.
//   buttonImage PNG, Logo auf weissen Knopf gebacken. NUR fuer E-Mail.
//   (PNG-Dateien podcast-apple.png / podcast-spotify.png liegen weiterhin in
//    public/ — app/api/newsletter/promo-block/route.ts liest sie mit hart
//    notiertem Dateinamen vom Dateisystem, um die Newsletter-Grafik zu bauen.
//    Nicht loeschen, auch wenn sie hier nicht mehr referenziert werden.)
//
// WARUM SVG IM WEB (2026-08-15): Die frueheren PNGs waren 240x39 bzw. 132x40
// gross — auf Retina sichtbar pixelig. Schlimmer noch: sie hatten BINAERES
// Alpha (kein einziger Wert zwischen 0 und 255), ihr Antialiasing steckte also
// als helle Pixel im Bild statt im Alphakanal, und die Punzen der Buchstaben
// waren deckend weiss gefuellt. Auf hellem Grund faellt beides nicht auf, auf
// schwarzem wurde daraus ein heller Saum um jede Kontur und weisse Flecken in
// jedem „o". Aus solchen Dateien ist das nicht reparierbar — die Information
// fehlt. Vektoren loesen beides zugleich.
//
// SVG geht NUR im Web: Gmail und die meisten Clients blockieren SVG, deshalb
// bleibt fuer E-Mail zwingend buttonImage.

export const PODCAST_APPLE = {
  name: 'Apple Podcasts',
  // KEIN `image`: Apple wird als INLINE-SVG gerendert
  // (components/podcast/apple-podcasts-badge.tsx), weil Schrift und Apfel auf
  // currentColor liegen und mit dem Theme kippen muessen — im Hellmodus
  // schwarz, im Dunkelmodus weiss. Ein <img src="…svg"> koennte das nicht: es
  // ist ein eigenes Dokument und erbt keine Textfarbe.
  //
  // Betreiber-Vorgabe 2026-08-15: freigestellt, ohne den schwarzen Knopfkoerper
  // und ohne den grauen Rahmen des Originals — es steht jetzt so frei wie das
  // Spotify-Logo daneben. Das lila Podcast-Zeichen behaelt seinen Verlauf und
  // kippt NICHT mit.
  //
  // 26 zu 26 mit Spotify: freigestellt hat der Badge das Seitenverhaeltnis
  // 4.47:1 (mit Knopf waren es 3.15:1), gleiche Hoehe stellt Apple-Zeichen und
  // Spotify-Kreis optisch gleich gross (visuell abgeglichen).
  height: 26,
  // Full white rounded-button PNG (logo baked onto white) for email: email
  // dark mode inverts CSS backgrounds but not image pixels, so a baked-in white
  // button stays white in Gmail iOS dark mode where a CSS white bg gets darkened.
  buttonImage: '/podcast-apple-button.png',
  url: 'https://podcasts.apple.com/de/podcast/synthszr/id1879733990',
} as const

export const PODCAST_SPOTIFY = {
  name: 'Spotify',
  // Offizielles Full Logo (Icon + Wortmarke) aus dem Spotify-Brand-Kit,
  // gruene RGB-Fassung. Ebenfalls eine Datei fuer beide Themes: das
  // Spotify-Gruen (#1ED760) traegt auf hellem wie auf dunklem Grund, und die
  // Markenfarbe zu tauschen waere ein unnoetiger Bruch. Die weisse Fassung aus
  // demselben Kit liegt bereit, falls das spaeter anders gewuenscht ist.
  image: '/podcast-spotify-logo.svg',
  // Anders als Apple bleibt Spotify ein <img>: das Logo ist einfarbig gruen und
  // braucht keine Theme-Kopplung, also auch kein Inline-Markup im HTML.
  height: 26,
  buttonImage: '/podcast-spotify-button.png',
  url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
} as const
