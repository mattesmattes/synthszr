import { Shield, AlertTriangle, CheckCircle2, Lock, Globe, Server, Database } from 'lucide-react'

export default function SecurityArchitecturePage() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" />
          Security Architecture
        </h1>
        <p className="text-muted-foreground mt-1">
          Dokumentation der Sicherheitsarchitektur, bekannter Risiken und durchgeführter Fixes.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Letztes Audit: 10.02.2026
        </p>
      </div>

      {/* Authentication & Authorization */}
      <Section
        icon={<Lock className="h-5 w-5" />}
        title="Authentication & Authorization"
      >
        <Subsection title="Session-Management">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>JWT-basierte Sessions via <Code>lib/auth/session.ts</Code></li>
            <li>HS256-signiert mit <Code>JWT_SECRET</Code> (min. 32 Zeichen in Production)</li>
            <li>HttpOnly, Secure, SameSite=Lax Cookie</li>
            <li>7-Tage Session-Dauer</li>
            <li>Timing-safe Passwort-Vergleich via <Code>timingSafeEqual</Code></li>
          </ul>
        </Subsection>

        <Subsection title="Route-Schutz">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>/admin/*</Code> und <Code>/api/admin/*</Code> geschützt via Middleware JWT-Verify</li>
            <li>API-Routen: <Code>requireAdmin(request)</Code> oder <Code>requireCronOrAdmin(request)</Code></li>
            <li>Cron-Endpoints akzeptieren <Code>Bearer CRON_SECRET</Code> Header ODER Admin-Session</li>
          </ul>
        </Subsection>

        <FixEntry
          severity="critical"
          date="2026-02-10"
          title="Fehlende Auth auf /api/cron/extract-patterns"
          description="POST und GET waren komplett ohne Authentifizierung zugänglich. Erlaubte unautorisierte Pattern-Extraktion mit Service-Role-Key-Zugriff auf die Datenbank."
          fix="requireCronOrAdmin(request) zu beiden Handlern hinzugefügt."
          file="app/api/cron/extract-patterns/route.ts"
        />
      </Section>

      {/* Rate Limiting */}
      <Section
        icon={<Server className="h-5 w-5" />}
        title="Rate Limiting"
      >
        <Subsection title="Architektur">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Upstash Redis Sliding Window via <Code>lib/rate-limit.ts</Code></li>
            <li>Presets: <Code>newsletter</Code> (10/h), <Code>strict</Code> (5/min), <Code>standard</Code> (30/min), <Code>relaxed</Code> (100/min), <Code>admin</Code> (60/min), <Code>adminWrite</Code> (20/min)</li>
            <li>Client-IP via <Code>x-forwarded-for</Code> / <Code>x-real-ip</Code> Header</li>
          </ul>
        </Subsection>

        <FixEntry
          severity="critical"
          date="2026-02-10"
          title="Rate-Limit Fallback erlaubte alle Requests ohne Redis"
          description="Wenn Upstash Redis nicht konfiguriert war, gab checkRateLimit() success: true zurück — auch in Production. Ermöglichte unbegrenzten API-Zugriff."
          fix="In Production wird bei fehlendem Redis jetzt success: false zurückgegeben. Nur in Development wird durchgelassen."
          file="lib/rate-limit.ts"
        />

        <FixEntry
          severity="medium"
          date="2026-02-10"
          title="Kein Rate-Limit auf /api/stock-quote"
          description="Öffentlicher Endpoint ohne Rate-Limiting, der externe EODHD-API Calls auslöst. Ermöglichte kostspieliges API-Quota-Burning."
          fix="Standard Rate-Limiter (30/min pro IP) hinzugefügt."
          file="app/api/stock-quote/route.ts"
        />
      </Section>

      {/* Secrets & Data Exposure */}
      <Section
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Secrets & Data Exposure"
      >
        <Subsection title="Richtlinien">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Keine API-Keys, Tokens oder Key-Prefixe in Logs oder API-Responses</li>
            <li>Environment-Checks nur als Boolean (<Code>hasKey: true/false</Code>)</li>
            <li><Code>.env</Code>-Dateien nicht in Git, restriktive Permissions</li>
          </ul>
        </Subsection>

        <FixEntry
          severity="high"
          date="2026-02-10"
          title="Service-Role-Key Prefix in Debug-Response"
          description="debug-pipeline Endpoint gab die ersten 10 Zeichen des SUPABASE_SERVICE_ROLE_KEY in der JSON-Response zurück."
          fix="serviceRoleKeyPrefix und supabaseUrl-Prefix durch Boolean-Flags ersetzt."
          file="app/api/admin/debug-pipeline/route.ts"
        />

        <FixEntry
          severity="high"
          date="2026-02-10"
          title="API-Key Logging in TTS-Service"
          description="ElevenLabs und OpenAI API-Keys wurden mit den ersten 8 und letzten 4 Zeichen in Vercel-Logs ausgegeben."
          fix="Log-Messages auf 'API key present' ohne Key-Material reduziert."
          file="lib/tts/elevenlabs-tts.ts"
        />
      </Section>

      {/* SSRF Protection */}
      <Section
        icon={<Globe className="h-5 w-5" />}
        title="SSRF & Input Validation"
      >
        <Subsection title="URL-Fetch-Richtlinien">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Serverseitige URL-Fetches nur gegen erlaubte Hosts (Allowlist)</li>
            <li>Nur HTTPS-Protokoll erlaubt</li>
            <li>Query-Parameter via <Code>encodeURIComponent</Code> escaped</li>
            <li>Supabase-Queries ausschließlich parametrisiert (kein SQL-Injection-Risiko)</li>
          </ul>
        </Subsection>

        <FixEntry
          severity="high"
          date="2026-02-10"
          title="SSRF via /api/newsletter/cover-image"
          description="Der url Query-Parameter wurde ohne Validierung an fetch() übergeben. Erlaubte Requests an interne Dienste (localhost, Metadata-APIs, private IPs)."
          fix="HTTPS-Pflicht + Host-Allowlist (supabase.co, unsplash.com, synthszr.com, etc.) hinzugefügt."
          file="app/api/newsletter/cover-image/route.ts"
        />
      </Section>

      {/* XSS */}
      <Section
        icon={<Database className="h-5 w-5" />}
        title="XSS & Content Security"
      >
        <Subsection title="Bekannte Patterns">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>tiptap-renderer.tsx</Code>: innerHTML für DOM-Reshuffling von Admin-Content (akzeptiertes Risiko — nur Admin schreibt Content)</li>
            <li>E-Mail-HTML: href-Werte mit <Code>encodeURIComponent</Code> escaped</li>
            <li>Keine <Code>dangerouslySetInnerHTML</Code> mit User-Input</li>
          </ul>
        </Subsection>

        <Subsection title="Akzeptierte Risiken">
          <p className="text-sm text-muted-foreground">
            innerHTML in tiptap-renderer.tsx wird für internes DOM-Reshuffling von Admin-generiertem TipTap-Content verwendet.
            Da nur authentifizierte Admins Content erstellen können, ist das XSS-Risiko minimal. Ein Fix würde
            unverhältnismäßige Komplexität einführen.
          </p>
        </Subsection>
      </Section>

      {/* Summary */}
      <div className="mt-8 rounded-lg border border-border p-4 bg-card">
        <h2 className="font-semibold mb-3">Zusammenfassung Audit 10.02.2026</h2>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="text-center">
            <div className="text-2xl font-bold text-red-500">2</div>
            <div className="text-muted-foreground">Critical (fixed)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-500">3</div>
            <div className="text-muted-foreground">High (fixed)</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-500">1</div>
            <div className="text-muted-foreground">Medium (fixed)</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-3 border-b border-border pb-2">
        {icon}
        {title}
      </h2>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  )
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground mb-1">{title}</h3>
      {children}
    </div>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
      {children}
    </code>
  )
}

function FixEntry({
  severity,
  date,
  title,
  description,
  fix,
  file,
}: {
  severity: 'critical' | 'high' | 'medium' | 'low'
  date: string
  title: string
  description: string
  fix: string
  file: string
}) {
  const colors = {
    critical: 'border-red-500/30 bg-red-500/5',
    high: 'border-orange-500/30 bg-orange-500/5',
    medium: 'border-yellow-500/30 bg-yellow-500/5',
    low: 'border-blue-500/30 bg-blue-500/5',
  }
  const badgeColors = {
    critical: 'bg-red-500/10 text-red-500',
    high: 'bg-orange-500/10 text-orange-500',
    medium: 'bg-yellow-500/10 text-yellow-600',
    low: 'bg-blue-500/10 text-blue-500',
  }

  return (
    <div className={`rounded-lg border p-3 ${colors[severity]}`}>
      <div className="flex items-center gap-2 mb-1">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badgeColors[severity]}`}>
          {severity.toUpperCase()}
        </span>
        <span className="text-xs text-muted-foreground">{date}</span>
      </div>
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
      <div className="mt-2 flex items-start gap-1">
        <span className="text-xs font-medium text-green-600">Fix:</span>
        <span className="text-xs text-muted-foreground">{fix}</span>
      </div>
      <div className="mt-1">
        <code className="text-xs text-muted-foreground font-mono">{file}</code>
      </div>
    </div>
  )
}
