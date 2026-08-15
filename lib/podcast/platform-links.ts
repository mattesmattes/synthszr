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
  // Offizieller „Listen on Apple Podcasts"-Badge (Apple Marketing Tools,
  // badge-2). Reine Vektoren, 13 KB. Die ebenfalls angebotene „glass"-Fassung
  // waere 667 KB gewesen — sie bettet das Icon als 2048px-PNG ein und haette
  // das Aufloesungsproblem nur verlagert.
  //
  // EINE Datei fuer beide Themes: der Badge bringt seinen Kontrast selbst mit
  // (schwarzer Koerper, grauer Rahmen, weisse Schrift). Auf hellem Grund traegt
  // der Koerper, auf dunklem der Rahmen. Genau dafuer ist der Rahmen da.
  image: '/podcast-apple-badge.svg',
  // Der Badge hat reichlich Innenabstand; auf gleiche Hoehe wie ein
  // freistehendes Logo gesetzt wirkte seine Schrift zu klein. 40 zu 26 gleicht
  // das optisch aus (visuell abgeglichen).
  height: 40,
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
  height: 26,
  buttonImage: '/podcast-spotify-button.png',
  url: 'https://open.spotify.com/show/0FJkPjKXvobgqI8U881yiF?si=wMJJ-CQxQdyuW18VXQZQOQ',
} as const
