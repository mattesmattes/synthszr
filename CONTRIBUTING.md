# Contributing to Synthszr

Thank you for your interest in contributing to Synthszr! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all backgrounds and experience levels.

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Supabase account (for database)
- Git

### Local Development Setup

```bash
# Fork and clone the repository
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

See `.env.example` for all required variables. At minimum, you need:
- Supabase credentials
- At least one AI API key (Anthropic, Google, or OpenAI)

## Development Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/updates

Example: `feature/add-dark-mode`

### Commit Messages

We follow conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Formatting (no code change)
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance

Example:
```
feat(newsletter): add unsubscribe confirmation page

- Added confirmation dialog before unsubscribe
- Updated email template with new link
```

### Code Style

- TypeScript strict mode
- ESLint + Prettier for formatting
- Use existing patterns in the codebase

### Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/lib/safe-json.test.ts

# Run API tests
pnpm test:api
```

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** with clear commits
3. **Add tests** for new functionality
4. **Update documentation** if needed
5. **Run tests locally** (`pnpm test`)
6. **Create a Pull Request** with:
   - Clear title and description
   - Link to related issues
   - Screenshots for UI changes

### PR Checklist

- [ ] Tests pass locally
- [ ] TypeScript compiles without errors
- [ ] Code follows existing patterns
- [ ] Documentation updated (if applicable)
- [ ] No console.log statements (use proper logging)
- [ ] No hardcoded secrets or credentials

## Project Structure

```
app/                    # Next.js App Router
├── admin/             # Admin dashboard
├── api/               # API routes
└── [lang]/            # Localized pages

lib/                    # Shared utilities
├── auth/              # Authentication
├── claude/            # AI integrations
├── security/          # Security utilities
├── supabase/          # Database clients
└── validation/        # Input validation

components/            # React components
tests/                 # Test files
```

## API Endpoints

When adding new API endpoints:

1. Add rate limiting for public endpoints
2. Add authentication for admin endpoints
3. Validate all inputs
4. Handle errors gracefully
5. Add appropriate logging

Example:
```typescript
export async function POST(request: NextRequest) {
  // 1. Origin check (CSRF)
  const originError = requireValidOrigin(request)
  if (originError) return originError

  // 2. Rate limiting
  const rateLimitResult = await checkRateLimit(...)
  if (!rateLimitResult.success) return rateLimitResponse(rateLimitResult)

  // 3. Input validation
  const body = await request.json()
  // validate...

  // 4. Business logic with error handling
  try {
    // ...
  } catch (error) {
    console.error('[endpoint] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

## Questions?

Feel free to open an issue for questions or discussions.
