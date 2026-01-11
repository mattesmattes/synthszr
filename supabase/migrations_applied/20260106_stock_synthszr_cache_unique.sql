-- Add unique constraint for proper upsert behavior
-- First, clean up any duplicates (keep the most recent)
DELETE FROM stock_synthszr_cache a
USING stock_synthszr_cache b
WHERE a.company = b.company
  AND a.currency = b.currency
  AND a.created_at < b.created_at;

-- Drop the existing index (will be replaced by unique constraint)
DROP INDEX IF EXISTS idx_stock_synthszr_cache_company;

-- Add unique constraint on (company, currency) for upsert to work
ALTER TABLE stock_synthszr_cache
ADD CONSTRAINT stock_synthszr_cache_company_currency_key
UNIQUE (company, currency);
