# Synthszr

[![Security Scan](https://github.com/mattesmattes/synthszr/actions/workflows/security.yml/badge.svg)](https://github.com/mattesmattes/synthszr/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered financial analysis and newsletter generation platform built with Next.js 15.

## Features

- **AI Stock Analysis** - Generate BUY/HOLD/SELL ratings for public and premarket companies
- **Newsletter Ingestion** - Automatically fetch and parse newsletters from Gmail
- **Ghostwriter** - AI-powered blog post generation with learned writing style
- **Edit Learning** - System learns from manual edits to improve future generations
- **Multi-language Support** - Automatic translation via AI models
- **Email Newsletters** - Send personalized newsletters to subscribers

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Database**: Supabase (PostgreSQL + pgvector)
- **AI Models**: Claude, Gemini, GPT-4
- **Email**: Resend
- **Styling**: Tailwind CSS + shadcn/ui
- **Editor**: TipTap

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Supabase account
- API keys for AI services (Anthropic, Google, OpenAI)

### Installation

```bash
# Clone the repository
git clone https://github.com/mattesmattes/synthszr.git
cd synthszr

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local

# Start development server
pnpm dev
```

### Environment Variables

See `.env.example` for all required and optional environment variables.

**Required:**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `ADMIN_EMAILS` - Comma-separated list of allowed admin emails
- At least one AI API key (ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENAI_API_KEY)

### Database Setup

Run the Supabase migrations:

```bash
supabase db push
```

## Development

```bash
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm test         # Run tests
pnpm lint         # Run linter
```

## Architecture

### Key Directories

```
app/                    # Next.js App Router pages
├── admin/             # Admin dashboard pages
├── api/               # API routes
└── [lang]/            # Localized public pages

lib/                    # Shared utilities
├── auth/              # Authentication helpers
├── claude/            # AI integration (Claude, Gemini)
├── edit-learning/     # Edit pattern learning system
├── newsletter/        # Newsletter processing
├── supabase/          # Database clients
└── validation/        # Input validation helpers

components/            # React components
├── admin/             # Admin-only components
├── ui/                # shadcn/ui components
└── tiptap-*.tsx       # Editor components
```

### API Routes

| Endpoint | Description |
|----------|-------------|
| `/api/stock-synthszr` | Generate AI stock analysis |
| `/api/premarket` | Fetch premarket company data |
| `/api/ghostwriter` | Generate blog posts |
| `/api/newsletter/subscribe` | Newsletter subscription |
| `/api/admin/*` | Admin-only endpoints |

## Security

This project implements comprehensive security measures:

- **Rate Limiting** - Redis-based rate limiting on public endpoints
- **CSRF Protection** - Origin header validation for form submissions
- **Authentication** - JWT sessions with Google OAuth for admin access
- **Input Validation** - Strict validation and sanitization
- **Security Headers** - X-Frame-Options, CSP, and more

For security vulnerabilities, please see [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting a pull request.

## License

MIT License - see [LICENSE](LICENSE) for details.
