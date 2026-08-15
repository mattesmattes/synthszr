/**
 * Das Theme steht, BEVOR der Body gerendert wird.
 *
 * DER KRITISCHE PUNKT BEIM DUNKELMODUS: Setzt man die Klasse erst nach dem
 * Hydrieren, sieht der Besucher für einen Sekundenbruchteil die helle Seite,
 * bevor sie umspringt. Das fällt genau denen auf, die den Dunkelmodus gewählt
 * haben — sie bekommen bei jedem Seitenaufruf einen weißen Blitz ins Gesicht.
 *
 * Verhindert wird das nur durch ein BLOCKIERENDES Skript im <head>: Es liest
 * die Wahl und setzt die Klasse, bevor der Browser irgendetwas zeichnet. Ein
 * `defer`, ein `useEffect` oder eine React-Komponente kommen alle zu spät.
 *
 * Deshalb ist das hier eine Zeichenkette und kein Modul: Sie wird direkt in ein
 * <script> geschrieben. Bundling würde sie ans Ende der Ladekette verschieben.
 */

/** Wo die Wahl liegt. Bewusst localStorage und kein Cookie: Das Theme ist eine
 *  reine Anzeigeeinstellung, der Server braucht sie nie. */
export const THEME_STORAGE_KEY = 'synthszr-theme'

export type Theme = 'light' | 'dark' | 'system'

/**
 * Läuft als erstes im <head>.
 *
 * Fällt es aus (localStorage gesperrt, Privatmodus), bleibt die Seite hell —
 * das ist der unauffälligere Fehler. Ein try/catch ist deshalb Pflicht: Eine
 * Ausnahme hier bräche das Rendern der gesamten Seite.
 */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var k = '${THEME_STORAGE_KEY}';
    var t = localStorage.getItem(k);
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = t === 'dark' || ((!t || t === 'system') && systemDark);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`.trim()
