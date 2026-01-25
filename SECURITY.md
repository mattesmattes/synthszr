# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** create a public GitHub issue for security vulnerabilities
2. Email security concerns to: [security@synthszr.com](mailto:security@synthszr.com)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Response Time**: We aim to respond within 48 hours
- **Updates**: We will keep you informed of our progress
- **Credit**: We will credit you in our release notes (unless you prefer anonymity)

## Security Measures

This project implements the following security measures:

### Authentication & Authorization
- JWT-based session management with secure cookies
- Google OAuth with email whitelist for admin access
- Timing-safe password comparison

### API Security
- Rate limiting on public endpoints (Upstash Redis)
- Origin header validation (CSRF protection)
- Input validation and sanitization
- Parameterized database queries (Supabase)

### Infrastructure
- Environment variable validation at startup
- Secure cron job authentication
- Security headers (X-Content-Type-Options, X-Frame-Options, etc.)

### CI/CD Security
- Automated dependency scanning (npm audit)
- Secret scanning (TruffleHog)
- Static analysis (CodeQL, Semgrep)

## Security Headers

The application sets the following security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Environment Variables

Never commit sensitive environment variables. See `.env.example` for required variables.

**Required in Production:**
- `JWT_SECRET` - Session signing key
- `CRON_SECRET` - Cron job authentication
- `SUPABASE_SERVICE_ROLE_KEY` - Database admin access

**Recommended:**
- `UPSTASH_REDIS_REST_URL` - Rate limiting
- `UPSTASH_REDIS_REST_TOKEN` - Rate limiting

## Dependencies

We regularly update dependencies to patch security vulnerabilities. Run `npm audit` to check for known issues.
