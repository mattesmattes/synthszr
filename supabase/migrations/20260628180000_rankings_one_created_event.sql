-- Genau-ein-created-Event pro Produkt auf DB-Ebene garantieren (Phase 1a).
-- resolveProduct macht INSERT + fängt 23505 (unique_violation) ab → race-safe,
-- selbstheilend, ohne auf PostgREST-onConflict gegen einen Partial-Index zu setzen.
CREATE UNIQUE INDEX IF NOT EXISTS product_identity_events_one_created_per_product
  ON product_identity_events(product_id)
  WHERE event_type = 'created';
