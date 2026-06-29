-- Erste AI-Produkt-Taxonomie (v1). feature_dimensions vorbereitet für 1b-iii (Features).
INSERT INTO product_categories (slug, name, description, feature_dimensions, display_order, taxonomy_version)
VALUES
  ('language-models', 'Sprachmodelle', 'LLMs & Foundation-Modelle (GPT, Claude, Gemini, Llama …)',
   '["Kontextfenster","Reasoning","Multimodalität","Geschwindigkeit","Preis"]'::jsonb, 1, 'v1'),
  ('coding-tools', 'Coding-Tools', 'AI-Coding-Assistenten & IDEs (Cursor, Claude Code, Copilot …)',
   '["IDE-Integration","Autonomie","Sprach-Support","Preis"]'::jsonb, 2, 'v1'),
  ('image-generation', 'Bildgeneratoren', 'Text-zu-Bild (Midjourney, DALL·E, Stable Diffusion …)',
   '["Bildqualität","Stilvielfalt","Geschwindigkeit","Preis"]'::jsonb, 3, 'v1'),
  ('video-generation', 'Videogeneratoren', 'Text-zu-Video (Sora, Veo …)',
   '["Videolänge","Auflösung","Realismus","Preis"]'::jsonb, 4, 'v1'),
  ('audio-voice', 'Audio & Stimme', 'Sprach-/Audio-AI (Wispr Flow, ElevenLabs …)',
   '["Stimmqualität","Sprachen","Latenz","Preis"]'::jsonb, 5, 'v1'),
  ('agents-platforms', 'Agenten & Plattformen', 'AI-Agenten & Build-Plattformen',
   '["Autonomie","Tool-Integration","Zuverlässigkeit","Preis"]'::jsonb, 6, 'v1'),
  ('search-research', 'Suche & Research', 'AI-Suche & Recherche (Perplexity …)',
   '["Quellenqualität","Aktualität","Tiefe","Preis"]'::jsonb, 7, 'v1'),
  ('other', 'Sonstige', 'Sonstige AI-Produkte',
   '[]'::jsonb, 99, 'v1')
ON CONFLICT (slug) DO NOTHING;
