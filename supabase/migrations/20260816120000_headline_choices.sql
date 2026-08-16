-- Auswertung der Überschriften-Wahl
--
-- Der Ghostwriter schlägt je Abschnitt drei Überschriften vor (journalistisch,
-- Pointe aus dem Take, Insight aus dem Widerspruch). Welche der Betreiber
-- wählt, beantwortet die Frage, an der sich der Prompt zweimal verhoben hat:
-- wie pointiert dürfen Überschriften sein? (Kalibrierungen bb8bfea → b9f07d0
-- → 2e4878b, siehe docs/konzept-headline-varianten.md.)
--
-- WARUM EINE EIGENE TABELLE und nicht das bestehende Edit-Learning: Dessen
-- Pattern-Mechanik arbeitet auf Satzebene und muss aus einem Diff erraten, was
-- geändert wurde. Hier ist die Auswahl explizit — drei bekannte Möglichkeiten,
-- eine davon geklickt. Das ist ein saubereres Signal und braucht keine
-- Interpretation.

CREATE TABLE IF NOT EXISTS headline_choices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Welcher Artikel. ON DELETE CASCADE: verschwindet der Artikel, ist die
  -- Wahl gegenstandslos.
  post_id UUID REFERENCES generated_posts(id) ON DELETE CASCADE,

  -- Welcher Abschnitt. queue_item_id ist die stabile Kennung (dieselbe
  -- Überlegung wie bei post_images.article_queue_item_id: eine Position bricht,
  -- sobald jemand Abschnitte umsortiert). Kann NULL sein — Bündel-Abschnitte
  -- fassen mehrere Items zusammen und haben keine einzelne Kennung.
  queue_item_id UUID REFERENCES news_queue(id) ON DELETE SET NULL,

  -- Alle Vorschläge, in der Reihenfolge, in der sie angeboten wurden.
  -- Index 0 ist die Überschrift, die beim Öffnen dastand.
  variants JSONB NOT NULL,

  -- Index des Gewählten in `variants`. 0 heißt: es blieb bei dem, was dastand.
  chosen_index INT NOT NULL,

  -- Der gewählte Text im Klartext. Redundant zu variants[chosen_index], aber
  -- die Auswertung soll ohne JSONB-Indizierung lesbar sein — und wenn jemand
  -- die Überschrift nach der Wahl noch von Hand ändert, steht hier weiterhin,
  -- was tatsächlich gewählt wurde.
  chosen_text TEXT NOT NULL,

  -- Stand der Ersetzung zum Zeitpunkt der Wahl (settings.headline_variants_config).
  -- Ohne dieses Feld wäre später nicht mehr zu unterscheiden, ob Index 0 die
  -- frisch erzeugte journalistische Variante war oder die alte Überschrift.
  replacement_active BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Eine Wahl je Abschnitt: ein zweiter Klick korrigiert den ersten, statt eine
-- zweite Zeile zu schreiben. Sonst zählte häufiges Ausprobieren mehrfach und
-- verzerrte die Auswertung.
CREATE UNIQUE INDEX IF NOT EXISTS headline_choices_post_item_idx
  ON headline_choices(post_id, queue_item_id)
  WHERE queue_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS headline_choices_created_idx
  ON headline_choices(created_at DESC);

COMMENT ON TABLE headline_choices IS
  'Welche der drei Ghostwriter-Überschriften der Betreiber gewählt hat. Grundlage für die Kalibrierung des ÜBERSCHRIFT-Blocks im SECTION_SYSTEM_PROMPT.';

-- RLS: nur der Service-Role-Schlüssel schreibt und liest. Es gibt keinen
-- Grund, warum ein Browser mit anon-Key hier herankommen sollte
-- (vgl. project_security_audit: anon konnte einmal alles lesen).
ALTER TABLE headline_choices ENABLE ROW LEVEL SECURITY;

-- Quittung: sollte 1 Zeile mit true, true zeigen.
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'headline_choices') AS tabelle_da,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'headline_choices_post_item_idx') AS index_da;
