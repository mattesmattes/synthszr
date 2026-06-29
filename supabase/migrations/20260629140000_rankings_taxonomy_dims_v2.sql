-- Präzisere Feature-Dimensionen (v2): mehrdeutige Namen entschärfen
-- ("Sprach-Support"→"Programmiersprachen"), damit die LLM-Extraktion nicht fehldeutet.
UPDATE product_categories SET feature_dimensions =
  '["Kontextfenster","Reasoning-Stärke","Multimodalität","Geschwindigkeit","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'language-models';
UPDATE product_categories SET feature_dimensions =
  '["IDE-Integration","Autonomie-Grad","Unterstützte Programmiersprachen","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'coding-tools';
UPDATE product_categories SET feature_dimensions =
  '["Bildqualität","Stilvielfalt","Generierungsgeschwindigkeit","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'image-generation';
UPDATE product_categories SET feature_dimensions =
  '["Max. Videolänge","Auflösung","Realismus","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'video-generation';
UPDATE product_categories SET feature_dimensions =
  '["Stimmqualität","Unterstützte Sprachen","Latenz","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'audio-voice';
UPDATE product_categories SET feature_dimensions =
  '["Autonomie-Grad","Tool-Integrationen","Zuverlässigkeit","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'agents-platforms';
UPDATE product_categories SET feature_dimensions =
  '["Quellenqualität","Aktualität","Antwort-Tiefe","Preis-Tier"]'::jsonb,
  taxonomy_version = 'v2' WHERE slug = 'search-research';
