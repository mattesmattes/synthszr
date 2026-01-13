# Synthszr Project

A Next.js 16 application for AI-powered financial analysis and newsletter generation.

## Key Features

### Synthszr Vote Badges
- Display investment ratings (BUY/HOLD/SELL) for companies mentioned in blog posts
- Public companies: Analysis generated via `/api/stock-synthszr` (AI-powered, cached)
- Premarket companies: Data fetched from glitch.green API

### Company Detection
- Natural mentions in text (e.g., "Nvidia reported...")
- Explicit `{Company}` directive tags (e.g., `{Palantir}`)
- Tags are hidden in rendered output but trigger rating display
- Exclusion list prevents false positives (e.g., "Insider", "Experte" are common nouns, not companies)

### Ghostwriter
- AI-powered blog post generation from daily digests
- Automatically adds `{Company}` tags for thematically relevant companies
- Supports multiple AI models (Claude, Gemini)

## Architecture

### Company Data
- `lib/data/companies.ts` - Auto-generated company dictionaries
- `KNOWN_COMPANIES` - Public companies with stock tickers
- `KNOWN_PREMARKET_COMPANIES` - Premarket companies from glitch.green
- `lib/data/company-exclusions.ts` - Words excluded from company detection
- Sync via: `npx tsx scripts/sync-premarket-companies.ts`

### TipTap Editor
- `components/tiptap-editor.tsx` - Admin editor
- `components/tiptap-renderer.tsx` - Reader component with company detection
- `lib/email/tiptap-to-html.ts` - Email HTML generation with vote badges

### Rating Generation
- `/api/stock-synthszr` - Generate/cache public company analysis
- `/api/stock-synthszr/batch-ratings` - Batch read ratings (read-only)
- `/api/premarket/batch-ratings` - Batch read premarket ratings

## Recent Changes (2026-01-13)

### Company Exclusion List
Prevents false positive Synthszr Vote badges for common German/English nouns:
- `lib/data/company-exclusions.ts` - Centralized exclusion Set
- Words like "Insider", "Experte", "Analyst", "Manager", "Partner" are excluded
- Applied in both `tiptap-renderer.tsx` (frontend) and `tiptap-to-html.ts` (email)
- To add exclusions: Edit `EXCLUDED_COMPANY_NAMES` Set in `company-exclusions.ts`

## Recent Changes (2026-01-11)

### Auto-trigger Synthszr Ratings on Post Save
When the Ghostwriter adds `{Company}` tags and the article is saved:
1. `extractCompanyTags()` extracts all `{Company}` patterns from TipTap JSON
2. Maps company names to API slugs using `KNOWN_COMPANIES` / `KNOWN_PREMARKET_COMPANIES`
3. `triggerSynthszrRatings()` fires background API calls:
   - Public companies: POST to `/api/stock-synthszr` (generates AI analysis)
   - Premarket companies: GET to `/api/premarket` (fetches from glitch.green)

This ensures Synthszr Vote badges appear when the post is viewed, even for companies not explicitly mentioned in the news.

**Location:** `app/admin/create-article/page.tsx` lines 394-472, 510-511

### Synthszr Take Styling
- Bold + uppercase for "Synthszr Take:" text
- Non-italic rendering in both editor and reader
- Background highlight: `#CCFF00`

### Company Tags Display Fix
- `{Company}` tags are stripped from visible text via `hideExplicitCompanyTags()`
- Tags still detected for rating lookup before removal

## Development

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run sync-companies  # Sync premarket companies from glitch.green
```

## Environment Variables

Required:
- `STOCKS_API_BASE_URL` - glitch.green API base (default: https://glitch.green)
- `STOCKS_PREMARKET_API_KEY` - API key for premarket data
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- AI model API keys (OpenAI, Anthropic, Google)
