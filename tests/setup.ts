import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: '.env.local' })

// Upstash-Credentials aus .env.local NICHT in Tests durchreichen: sonst spricht
// der geteilte Begriffs-Cache (lib/glossary/shared-cache.ts) echtes Redis an —
// langsam, nicht deterministisch, und er beantwortet Testfaelle aus fremden
// Laeufen. Ohne Konfiguration faellt withSharedCache auf den Loader durch, also
// exakt auf das Verhalten vor der Cache-Schicht. Tests, die die Schicht selbst
// pruefen, setzen die Variablen per vi.stubEnv wieder.
delete process.env.KV_REST_API_URL
delete process.env.KV_REST_API_TOKEN
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN
