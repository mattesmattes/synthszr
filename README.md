# Synthszr

[![Security Scan](https://github.com/mattesmattes/synthszr/actions/workflows/security.yml/badge.svg)](https://github.com/mattesmattes/synthszr/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI-powered newsletter aggregator with a twist.
Architecture overview: https://synthszr.com/docs/architecture

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/mattesmattes/synthszr.git
cd synthszr
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Authentication (Required)
JWT_SECRET=your-32-character-minimum-secret-key
ADMIN_EMAILS=your-email@example.com

# Google OAuth (Required for admin login)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# AI Services (At least one required)
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-key
OPENAI_API_KEY=sk-...

# Email (Required for newsletters)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Newsletter <newsletter@yourdomain.com>

# Rate Limiting (Required for production)
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-token

# Cron Jobs (Required for production)
CRON_SECRET=your-cron-secret
```

### 3. Database Setup

Create a Supabase project and run migrations:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### 4. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Production Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Required Production Environment Variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Minimum 32 characters, cryptographically random |
| `CRON_SECRET` | Secret for cron job authentication |
| `UPSTASH_REDIS_REST_URL` | Redis for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token |
| `SUPABASE_SERVICE_ROLE_KEY` | Database admin access |

### Cron Jobs Setup (Vercel)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/scheduled-tasks",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

## Commands

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm test         # Run tests
pnpm lint         # Run linter
pnpm test:api     # Run API tests only
```

## Project Structure

```
app/
├── admin/              # Admin dashboard
├── api/                # API routes
│   ├── admin/          # Protected admin endpoints
│   ├── cron/           # Cron job endpoints
│   ├── newsletter/     # Public newsletter endpoints
│   └── stock-synthszr/ # Stock analysis endpoints
└── [lang]/             # Localized public pages

lib/
├── auth/               # Authentication (JWT, OAuth)
├── security/           # Security utilities (CSRF, rate limiting)
├── supabase/           # Database clients
├── claude/             # AI integrations
└── newsletter/         # Newsletter processing

components/
├── admin/              # Admin components
├── ui/                 # shadcn/ui components
└── tiptap-*.tsx        # Rich text editor
```

## External Services

| Service | Purpose | Required |
|---------|---------|----------|
| [Supabase](https://supabase.com) | Database (PostgreSQL + pgvector) | Yes |
| [Vercel](https://vercel.com) | Hosting & Cron | Yes |
| [Upstash](https://upstash.com) | Redis for rate limiting | Production |
| [Resend](https://resend.com) | Email sending | For newsletters |
| [Anthropic](https://anthropic.com) | Claude AI | At least one AI |
| [Google AI](https://ai.google.dev) | Gemini AI | At least one AI |
| [OpenAI](https://openai.com) | GPT-4 | At least one AI |

## Security

See [SECURITY.md](SECURITY.md) for:
- Security measures implemented
- How to report vulnerabilities
- Security headers and protections

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Code style guidelines
- Pull request process

## License

MIT License - see [LICENSE](LICENSE)
