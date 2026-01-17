-- Add content_prompt column to synthesis_prompts for content-only syntheses
-- These are used when no similar historical article is found

ALTER TABLE synthesis_prompts
ADD COLUMN IF NOT EXISTS content_prompt TEXT;

-- Update the active prompt with a default content-only prompt
UPDATE synthesis_prompts
SET content_prompt = 'Erstelle einen originellen Insight aus diesem Artikel:

NEWS: {current_news}

KERNTHESE ZUR ORIENTIERUNG:
{core_thesis}

Generiere einen prägnanten Synthese-Kommentar (2-4 Sätze), der:
1. Das Kernthema zusammenfasst
2. Einen originellen Insight liefert
3. Zur Kernthese passt (falls relevant)

Format:
HEADLINE: [Kurze, prägnante Überschrift]
SYNTHESE: [Der Insight-Text]'
WHERE is_active = true AND content_prompt IS NULL;
