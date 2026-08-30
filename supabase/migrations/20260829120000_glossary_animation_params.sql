-- Bewegungsparameter fuer die Dither-Illustrationen (Vollkorpus-Test
-- 29.08.2026, 2376/2376 kalibriert und verifiziert). Ein Muster (drift/sway/
-- flow/ripple/pulse/spin/shimmer) plus die dazu kalibrierte Amplitude reichen
-- aus, um die vorhandene Illustration client-seitig per WebGPU (vgpu) subtil
-- zu animieren -- kein zusaetzliches Bild, keine Pipeline-Aenderung.
--
-- Nullable und ohne Default: Begriffe ohne Eintrag zeigen weiterhin nur das
-- statische Bild (Ist-Zustand), das ist kein Fehlerfall.
alter table public.glossary_terms
  add column if not exists animation_params jsonb;

comment on column public.glossary_terms.animation_params is
  'Kalibrierte Bewegungsparameter fuer die Dither-Animation: {muster, amp, pivot?, dosis}. NULL = keine Animation, Illustration bleibt statisch.';
