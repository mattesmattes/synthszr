-- Add dithering settings to image_prompts table
ALTER TABLE image_prompts
ADD COLUMN IF NOT EXISTS enable_dithering BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS dithering_gain DECIMAL(3,2) DEFAULT 1.0;

-- Add comment for documentation
COMMENT ON COLUMN image_prompts.enable_dithering IS 'Enable Floyd-Steinberg error diffusion dithering';
COMMENT ON COLUMN image_prompts.dithering_gain IS 'Error diffusion gain/scaling factor (0.5-2.0)';
