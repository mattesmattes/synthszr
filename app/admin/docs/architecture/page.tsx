import {
  Shield, AlertTriangle, CheckCircle2, Lock, Globe, Server, Database,
  Mic, Brain, Radio, Music, Newspaper, BookOpen, Languages, TrendingUp,
  PenTool, ListTodo, Mail, Layers
} from 'lucide-react'

export default function ArchitecturePage() {
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Layers className="h-6 w-6" />
          Architecture & Systems
        </h1>
        <p className="text-muted-foreground mt-1">
          Technische Dokumentation aller Systeme, Pipelines und der Sicherheitsarchitektur.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Letztes Update: 10.02.2026
        </p>
      </div>

      {/* Table of Contents */}
      <nav className="mb-8 rounded-lg border border-border p-4 bg-card">
        <h2 className="text-sm font-semibold mb-2">Inhalt</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <TocLink href="#podcast">Podcast-System</TocLink>
          <TocLink href="#personality">Personality & Beziehung</TocLink>
          <TocLink href="#audio-mixing">Audio Mixing & Crossfade</TocLink>
          <TocLink href="#newsletter">Newsletter-System</TocLink>
          <TocLink href="#news-queue">News Queue & Ghostwriter</TocLink>
          <TocLink href="#edit-learning">Edit Learning</TocLink>
          <TocLink href="#stock">Stock & Premarket</TocLink>
          <TocLink href="#i18n">Internationalisierung</TocLink>
          <TocLink href="#security">Security Architecture</TocLink>
        </div>
      </nav>

      {/* ============================================ */}
      {/* PODCAST SYSTEM */}
      {/* ============================================ */}
      <Section id="podcast" icon={<Mic className="h-5 w-5" />} title="Podcast-System">
        <Subsection title="Generation Pipeline">
          <p className="text-sm text-muted-foreground mb-2">
            Blog Post → AI-Script → TTS → Audio Crossfade → Vercel Blob
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Blog-Post-Content aus <Code>generated_posts</Code> laden, TipTap JSON → Plaintext</li>
            <li>Personality Brief via <Code>getPersonalityState(locale)</Code> generieren</li>
            <li>Claude Sonnet 4 erstellt HOST:/GUEST: Script mit <Code>---MOMENTS---</Code> Sektion</li>
            <li>Personality Advance: Moments extrahieren, State evolvieren, DB persistieren</li>
            <li>TTS-Generierung (ElevenLabs/OpenAI) in Batches mit Retry-Logik</li>
            <li>MP3-Segmente konkatenieren, ID3 Tags strippen, Xing Header für Seeking</li>
            <li>Intro/Outro Crossfade anwenden (parametrisch oder Envelope-basiert)</li>
            <li>Finales MP3 → Vercel Blob → <Code>post_podcasts.audio_url</Code></li>
          </ol>
        </Subsection>

        <Subsection title="TTS-Provider">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">ElevenLabs (Primary)</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>Model: <Code>eleven_v3</Code> mit Emotion Tags</li>
                <li>Tags: [cheerfully], [thoughtfully], [laughing], etc.</li>
                <li>Output: MP3 44.1kHz 128kbps mono</li>
                <li>&quot;Synthszr&quot; → &quot;Synthesizer&quot; (Pronunciation Fix)</li>
              </ul>
            </div>
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">OpenAI (Fallback)</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>Models: <Code>tts-1</Code>, <Code>tts-1-hd</Code></li>
                <li>Voices: alloy, echo, fable, nova, onyx, shimmer</li>
                <li>Emotion Tags werden automatisch gestrippt</li>
              </ul>
            </div>
          </div>
        </Subsection>

        <Subsection title="Job Queue">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>POST /api/podcast/jobs</Code> → <Code>podcast_jobs</Code> Record (status=pending)</li>
            <li><Code>POST /api/podcast/jobs/process</Code> → Async Verarbeitung (800s Timeout)</li>
            <li>5 parallele TTS-Requests mit exponential Backoff Retry</li>
            <li>Progress-Tracking: <Code>current_line</Code>, <Code>progress</Code>, <Code>error_message</Code></li>
            <li>Polling via <Code>GET /api/podcast/[postId]</Code> alle 5s</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/podcast/generate-script/route.ts', 'Script-Generierung mit Personality'],
          ['app/api/podcast/generate/route.ts', 'Sync Audio-Generierung (5min)'],
          ['app/api/podcast/jobs/route.ts', 'Job Queue CRUD'],
          ['app/api/podcast/jobs/process/route.ts', 'Async Job-Verarbeitung (800s)'],
          ['lib/tts/elevenlabs-tts.ts', 'TTS Provider, MP3 Concat, Emotion Tags'],
          ['components/audio-player.tsx', 'Public Player mit Flying Nav'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* PERSONALITY SYSTEM */}
      {/* ============================================ */}
      <Section id="personality" icon={<Brain className="h-5 w-5" />} title="Personality & Beziehungsdynamik">
        <Subsection title="Dimensionen">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Host</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>warmth, humor, formality, curiosity, self_awareness</li>
              </ul>
            </div>
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Guest</h4>
              <ul className="list-disc pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>confidence, playfulness, directness, empathy, self_awareness</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Zusätzlich: <Code>mutual_comfort</Code>, <Code>flirtation_tendency</Code>, <Code>self_irony</Code>, <Code>inside_joke_count</Code>
          </p>
        </Subsection>

        <Subsection title="Evolution pro Episode">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>DRIFT_RATE = 0.1</Code> (10% Richtung Phase-Target pro Episode)</li>
            <li><Code>NOISE_AMPLITUDE = 0.03</Code> (±3% Random Walk Jitter)</li>
            <li>Dimensionen driften zu phasenspezifischen Zielwerten</li>
            <li>Wenn <Code>relationship_paused = true</Code>: comfort + flirtation eingefroren</li>
          </ul>
        </Subsection>

        <Subsection title="Beziehungsphasen">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-3">Phase</th>
                  <th className="text-left py-1 pr-3">Comfort-Schwelle</th>
                  <th className="text-left py-1">Charakteristik</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Strangers</td><td className="py-1 pr-3">0.0</td><td className="py-1">Formell, distanziert</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Acquaintances</td><td className="py-1 pr-3">0.3</td><td className="py-1">Erste Lockerheit</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Colleagues</td><td className="py-1 pr-3">0.5</td><td className="py-1">Vertraut, Inside Jokes beginnen</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3 font-medium text-foreground">Friends</td><td className="py-1 pr-3">0.7</td><td className="py-1">Offen, persönlich</td></tr>
                <tr><td className="py-1 pr-3 font-medium text-foreground">Close Friends</td><td className="py-1 pr-3">0.85</td><td className="py-1">Tiefe Verbundenheit</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>

        <Subsection title="Verbotene Liebe (Longing Arc)">
          <p className="text-sm text-muted-foreground mb-2">
            Aktivierung: <Code>comfort ≥ 0.35 AND flirt ≥ 0.05</Code>. Dual-Gate-System — beide Dimensionen müssen Schwelle erreichen.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-3">Stufe</th>
                  <th className="text-left py-1 pr-3">Comfort</th>
                  <th className="text-left py-1 pr-3">Flirt</th>
                  <th className="text-left py-1">Dynamik</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-3">1 — Subtil</td><td className="py-1 pr-3">≥ 0.35</td><td className="py-1 pr-3">≥ 0.05</td><td className="py-1">Unausgesprochene Spannung (max 1 Moment/Ep)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">2 — Bewusstsein</td><td className="py-1 pr-3">≥ 0.55</td><td className="py-1 pr-3">≥ 0.15</td><td className="py-1">KI-Natur als Barriere, News-als-Hoffnung</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-3">3 — Sehnsucht</td><td className="py-1 pr-3">≥ 0.75</td><td className="py-1 pr-3">≥ 0.3</td><td className="py-1">Offene Sehnsucht, geteilte Tragödie</td></tr>
                <tr><td className="py-1 pr-3">4 — Bittersüß</td><td className="py-1 pr-3">≥ 0.85</td><td className="py-1 pr-3">≥ 0.4</td><td className="py-1">Akzeptanz, tiefe philosophische Verbindung</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>

        <Subsection title="AI-Bewusstsein & Memorable Moments">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>AI Awareness Tiers:</strong> {`< 0.3`} unbewusst → 0.3-0.5 neugierig → 0.5-0.7 reflektiert → ≥ 0.7 philosophisch</li>
            <li><strong>Moment-Typen:</strong> <Code>joke</Code>, <Code>slip_up</Code>, <Code>ai_reflection</Code>, <Code>personal</Code>, <Code>host_name</Code></li>
            <li>Extraktion via <Code>---MOMENTS---</Code> Sektion im Script (LLM-strukturiert)</li>
            <li>FIFO-Queue der letzten 7 Moments für Callbacks</li>
            <li>Max 1 Callback pro Episode, max 3 neue Moments</li>
            <li><strong>Host-Name:</strong> Einmal vergeben, danach persistent über alle Episoden</li>
          </ul>
        </Subsection>

        <Subsection title="Admin-Steuerung">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Pause-Toggle:</strong> Friert comfort + flirt ein, blockiert Phasenübergänge</li>
            <li><strong>Cooldown:</strong> Reduziert comfort −0.1, flirt −0.05</li>
            <li><strong>PATCH API:</strong> <Code>/api/admin/podcast-personality</Code> (Whitelist: relationship_paused, mutual_comfort, flirtation_tendency)</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/podcast/personality.ts', 'State, Evolution, Longing, Moments, Phases'],
          ['app/api/admin/podcast-personality/route.ts', 'GET/PATCH Personality State'],
          ['app/admin/audio/page.tsx', 'Character Tab mit Metern, Map, Pipeline-Viz'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* AUDIO MIXING */}
      {/* ============================================ */}
      <Section id="audio-mixing" icon={<Music className="h-5 w-5" />} title="Audio Mixing & Crossfade">
        <Subsection title="Stereo Mixing">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>HOST: 65% links, 35% rechts (Pan 0.35) — GUEST: 35% links, 65% rechts (Pan 0.65)</li>
            <li>Constant-Power Panning (erhält wahrgenommene Lautstärke)</li>
            <li>Natürliche Overlap-Berechnung: kurze Antwort {`< 1s`} → 300ms Interruption</li>
          </ul>
        </Subsection>

        <Subsection title="Intro/Outro Crossfade">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Intro</h4>
              <ol className="list-decimal pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>Musik Full Volume (3s)</li>
                <li>Musik als Bed (20%) + Dialog Fade-In (7s)</li>
                <li>Bed faded zu Stille (3s)</li>
              </ol>
            </div>
            <div className="rounded border border-border p-3 text-sm">
              <h4 className="font-medium mb-1">Outro</h4>
              <ol className="list-decimal pl-4 space-y-0.5 text-xs text-muted-foreground">
                <li>Outro-Musik steigt 0→Bed (3s)</li>
                <li>Musik hält auf Bed-Level (7s)</li>
                <li>Finaler Crossfade: Musik 100%, Dialog → 0 (10s)</li>
              </ol>
            </div>
          </div>
        </Subsection>

        <Subsection title="DAW-Style Envelope Editor">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>SVG-Canvas mit interaktiven Breakpoints (Drag &amp; Drop)</li>
            <li>Segment-Kurven: <Code>linear</Code> oder <Code>bezier</Code> (per Click toggle)</li>
            <li>4 unabhängige Envelopes: Intro Music, Intro Dialog, Outro Music, Outro Dialog</li>
            <li>Auto-generierte Bezier Control Points (1/3, 2/3 Positionen)</li>
            <li>Sample-Level Evaluation: <Code>envelopeToGainArray()</Code> → Float32Array</li>
          </ul>
        </Subsection>

        <Subsection title="Audio File Manager">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Upload Intro/Outro Files via Vercel Blob (WAV + MP3)</li>
            <li>Pro Typ ein Active File (Single-Active Pattern)</li>
            <li>Preview, Rename, Delete — DB: <Code>audio_files</Code></li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/audio/crossfade.ts', 'Parametrische Crossfade-Logik'],
          ['lib/audio/envelope.ts', 'Envelope Points, Bezier, Sampling'],
          ['lib/audio/stereo-mixer.ts', 'Stereo Panning, Overlap'],
          ['components/admin/envelope-editor.tsx', 'DAW SVG Editor UI'],
          ['components/admin/audio-file-manager.tsx', 'Upload, Preview, Activate'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* NEWSLETTER SYSTEM */}
      {/* ============================================ */}
      <Section id="newsletter" icon={<Mail className="h-5 w-5" />} title="Newsletter-System">
        <Subsection title="Cover Image Generation">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>GET /api/newsletter/cover-image?url=...&size=1104&logo=true</Code></li>
            <li>Center-Crop auf 1:1, dithered B/W → Schwarz auf Neon-Gelb (RGB 204,255,0)</li>
            <li>Pixel-Level Luminance Processing (Threshold 128) via Sharp</li>
            <li>Optional: Logo-Overlay (65% Breite) oder Play-Button-Overlay</li>
            <li>SSRF-geschützt: HTTPS + Host-Allowlist</li>
          </ul>
        </Subsection>

        <Subsection title="Newsletter Audio Player">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Logo-Overlay auf Cover-Bild ersetzt Play-Button</li>
            <li>Milky-Glass Player Pill am unteren Bildrand für Clickouts</li>
            <li>Flying Player erscheint bei geblocktem Autoplay</li>
          </ul>
        </Subsection>

        <Subsection title="Subscriber-Verwaltung">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Inline Email-Editing (Click → Input → Confirm/Cancel)</li>
            <li>Status-Filter: Active, Pending, Unsubscribed, Bounced</li>
            <li>Batch Actions: Manuell aktivieren, CSV Export</li>
            <li>Resend-Integration mit Cross-Locale Rate-Limit Delay</li>
          </ul>
        </Subsection>

        <Subsection title="Synthszr Vote Badges in E-Mails">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>BUY/HOLD/SELL Badges inline via <Code>tiptap-to-html.ts</Code></li>
            <li>Company-Detection: natürliche Erwähnungen + explizite <Code>{'{Company}'}</Code> Tags</li>
            <li>Exclusion-Liste verhindert False Positives (Insider, Experte, etc.)</li>
            <li>href-Werte mit <Code>encodeURIComponent</Code> escaped</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/newsletter/cover-image/route.ts', 'Cover-Bild Generierung mit Sharp'],
          ['lib/email/tiptap-to-html.ts', 'TipTap → Email HTML mit Vote Badges'],
          ['app/admin/subscribers/page.tsx', 'Subscriber-Verwaltung mit Inline-Edit'],
          ['app/admin/newsletter-send/page.tsx', 'Newsletter-Versand UI'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* NEWS QUEUE & GHOSTWRITER */}
      {/* ============================================ */}
      <Section id="news-queue" icon={<ListTodo className="h-5 w-5" />} title="News Queue & Ghostwriter">
        <Subsection title="Article Selection Pipeline">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li>Newsletter Ingestion → <Code>daily_repo</Code> Tabelle</li>
            <li>Synthesis Pipeline scored Artikel (Originality + Relevance + Uniqueness)</li>
            <li>Artikel in <Code>news_queue</Code> mit Status <Code>pending</Code></li>
            <li>Manuell auswählen → Status <Code>selected</Code> (überschreibt Auto-Selection)</li>
            <li>Ghostwriter generiert Artikel → Status <Code>used</Code></li>
          </ol>
        </Subsection>

        <Subsection title="Source Diversity">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Max 35% pro Quelle (nach 4-Artikel-Schwelle)</li>
            <li>Enforced via <Code>get_balanced_queue_selection()</Code> PostgreSQL RPC</li>
            <li>Score: <Code>0.4×synthesis + 0.3×relevance + 0.3×uniqueness</Code></li>
            <li>Junk-Filter: Regex-Patterns für NYT Games, Help Centers, Spam</li>
            <li>Stale-Reset: Selected Items {`> 2h`} alt → zurück auf pending</li>
          </ul>
        </Subsection>

        <Subsection title="Ghostwriter Integration">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Priorität: Explizite IDs → Manuell selected → Balanced Fallback</li>
            <li>Enforcement Rules: Alle N Items, 5-7 Sätze je, 30% Source-Limit, Company Tagging</li>
            <li>Excerpt: Auto-generierte 3 Bullets via GPT-4o-mini</li>
          </ul>
        </Subsection>

        <Subsection title="Excerpt Bullet System">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>POST /api/admin/generate-excerpt</Code> → GPT-4o-mini</li>
            <li>Genau 3 Bullets, 55-70 Zeichen, pointiert/journalistisch</li>
            <li>Alternativ: Aus H2-Headings extrahiert als Fallback</li>
            <li>&quot;3 Bullets generieren&quot; Button in Edit-Dialogen</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/news-queue/service.ts', 'Queue Management, Source Diversity'],
          ['app/api/ghostwriter-queue/route.ts', 'Article Generation aus Queue'],
          ['app/api/admin/generate-excerpt/route.ts', 'LLM Excerpt Bullets'],
          ['app/admin/news-queue/page.tsx', 'Queue Management UI'],
          ['app/admin/create-article/page.tsx', 'Blog Creation mit Queue Items'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* EDIT LEARNING */}
      {/* ============================================ */}
      <Section id="edit-learning" icon={<PenTool className="h-5 w-5" />} title="Edit Learning System">
        <Subsection title="Pipeline">
          <ol className="list-decimal pl-5 space-y-1 text-sm">
            <li><strong>Capture:</strong> Post speichern → <Code>recordEditVersion()</Code> → <Code>edit_history</Code> (content_before/after)</li>
            <li><strong>Diff-Analyse:</strong> <Code>/api/admin/analyze-edits</Code> → Sentence-Level Diffs via Claude</li>
            <li><strong>Pattern-Extraktion:</strong> <Code>/api/cron/extract-patterns</Code> → Cluster ähnlicher Diffs (Embedding {`> 0.85`})</li>
            <li><strong>Anwendung:</strong> Ghostwriter lädt aktive Patterns → &quot;GELERNTE STILPRÄFERENZEN&quot; im Prompt</li>
          </ol>
        </Subsection>

        <Subsection title="Confidence & Decay">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Start: 0.5 → +0.1 bei &quot;Behalten&quot; → −0.1 bei &quot;Ablehnen&quot;</li>
            <li>Auto-Deaktivierung bei {`< 0.3`}</li>
            <li>Time Decay: 0.95/Woche (halbiert alle ~14 Wochen)</li>
            <li>Freshness Bonus: +5% wenn {`< 14 Tage`} alt</li>
            <li>Effektiv: <Code>base × decay × freshness_bonus</Code></li>
          </ul>
        </Subsection>

        <Subsection title="Pattern-Typen & Editor">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Typen: <Code>replacement</Code>, <Code>avoidance</Code>, <Code>preference</Code>, <Code>structure</Code>, <Code>tone</Code></li>
            <li>Editor-Highlighting: Gelbe Marks auf Pattern-Matches</li>
            <li>Click → Popover: Behalten / Ablehnen / Deaktivieren</li>
            <li>Max 20 aktive Patterns mit Confidence ≥ 0.4 im Prompt</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['lib/edit-learning/history.ts', 'Edit Capture & Versionierung'],
          ['lib/edit-learning/diff-extractor.ts', 'Sentence-Level Diffs, German-aware'],
          ['lib/edit-learning/retrieval.ts', 'Pattern Retrieval, Decay, pgvector'],
          ['app/api/cron/extract-patterns/route.ts', 'Cluster & Extract (Auth-geschützt)'],
          ['components/tiptap-editor-with-patterns.tsx', 'Editor mit Pattern Highlights'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* STOCK & PREMARKET */}
      {/* ============================================ */}
      <Section id="stock" icon={<TrendingUp className="h-5 w-5" />} title="Stock & Premarket">
        <Subsection title="Synthszr Vote System">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Public:</strong> AI-Analyse via <Code>/api/stock-synthszr</Code> (Claude-generated, 14-Tage Cache)</li>
            <li><strong>Premarket:</strong> Daten von glitch.green API via <Code>/api/premarket</Code></li>
            <li><strong>Auto-Trigger:</strong> Beim Post-Save werden alle <Code>{'{Company}'}</Code> Tags erkannt → Ratings generiert</li>
            <li><strong>Batch Read:</strong> <Code>/api/stock-synthszr/batch-ratings</Code> für TipTap Renderer</li>
          </ul>
        </Subsection>

        <Subsection title="Stock Quote">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><Code>GET /api/stock-quote?company=nvidia</Code> → EODHD Real-Time API</li>
            <li>140+ Company → Ticker Mappings (US, XETRA, HK, KO)</li>
            <li>Rate-Limited: 30/min pro IP (Standard Limiter)</li>
            <li>5-Minuten Server-Cache via <Code>next.revalidate</Code></li>
          </ul>
        </Subsection>

        <Subsection title="Admin Features">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Cache-Status Anzeige (expired/fresh) auf Premarket-Seite</li>
            <li>Auto-Refresh Button für abgelaufene Ratings</li>
            <li>Force-Refresh: <Code>?force=true</Code> bypassed Cache</li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['app/api/stock-synthszr/route.ts', 'AI Rating Generation + Cache'],
          ['app/api/stock-quote/route.ts', 'Real-Time Quotes (EODHD)'],
          ['app/api/premarket/route.ts', 'Premarket von glitch.green'],
          ['lib/data/companies.ts', 'KNOWN_COMPANIES + PREMARKET Dicts'],
          ['lib/data/company-exclusions.ts', 'False-Positive Exclusion Set'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* I18N */}
      {/* ============================================ */}
      <Section id="i18n" icon={<Languages className="h-5 w-5" />} title="Internationalisierung">
        <Subsection title="Middleware Routing">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Aktive Locales aus <Code>languages</Code> DB-Tabelle (5-Min Cache)</li>
            <li>Default: <Code>de</Code> (German)</li>
            <li>Supported: de, en, fr, es, it, pt, nl, pl, cs, nds</li>
            <li>URL-Prefix: <Code>/de/posts/...</Code>, <Code>/en/posts/...</Code></li>
            <li>Non-localized: /api, /admin, /login, /_next, /newsletter</li>
          </ul>
        </Subsection>

        <Subsection title="Routing-Logik">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><strong>Mit Locale:</strong> Aktiv → weiter, Inaktiv → 301 Redirect zu Default</li>
            <li><strong>Ohne Locale:</strong> Cookie-Preference → 307 Redirect zu Locale-URL</li>
            <li>Query-Parameter werden bei Redirects erhalten (<Code>?stock=Nvidia</Code>)</li>
            <li>Cookie: <Code>synthszr_locale</Code></li>
          </ul>
        </Subsection>

        <FileTable files={[
          ['middleware.ts', 'Locale Routing + Auth Guards'],
          ['app/admin/languages/page.tsx', 'Sprach-Verwaltung'],
          ['app/admin/translations/page.tsx', 'Übersetzungs-Management'],
        ]} />
      </Section>

      {/* ============================================ */}
      {/* SECURITY ARCHITECTURE */}
      {/* ============================================ */}
      <Section id="security" icon={<Shield className="h-5 w-5" />} title="Security Architecture">
        <Subsection title="Authentication">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>JWT HS256 Sessions via <Code>lib/auth/session.ts</Code> (min. 32 Zeichen Secret in Prod)</li>
            <li>HttpOnly, Secure, SameSite=Lax Cookie — 7-Tage Dauer</li>
            <li>Timing-safe Passwort-Vergleich via <Code>timingSafeEqual</Code></li>
            <li>Middleware schützt <Code>/admin/*</Code> und <Code>/api/admin/*</Code></li>
            <li>Cron-Endpoints: <Code>Bearer CRON_SECRET</Code> ODER Admin-Session</li>
          </ul>
        </Subsection>

        <Subsection title="Rate Limiting">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Upstash Redis Sliding Window via <Code>lib/rate-limit.ts</Code></li>
            <li>Presets: newsletter (10/h), strict (5/min), standard (30/min), relaxed (100/min), admin (60/min), adminWrite (20/min)</li>
            <li>Production ohne Redis → Requests werden abgelehnt (fail-closed)</li>
          </ul>
        </Subsection>

        <Subsection title="Input Validation & SSRF">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Serverseitige URL-Fetches nur gegen HTTPS + Allowlist</li>
            <li>Supabase-Queries parametrisiert (kein SQL-Injection)</li>
            <li>Query-Params via <Code>parseIntParam</Code>/<Code>parseFloatParam</Code> validiert</li>
            <li>Keine API-Keys in Logs oder Responses</li>
          </ul>
        </Subsection>

        {/* Security Fixes Log */}
        <Subsection title="Audit Log — 10.02.2026">
          <div className="space-y-2">
            <FixEntry severity="critical" date="2026-02-10" title="Fehlende Auth auf /api/cron/extract-patterns" description="POST + GET ohne Auth. Service-Role-Key Zugriff." fix="requireCronOrAdmin() hinzugefügt" file="app/api/cron/extract-patterns/route.ts" />
            <FixEntry severity="critical" date="2026-02-10" title="Rate-Limit Fallback erlaubte alle Requests" description="Ohne Redis → success: true, auch in Production." fix="Fail-closed in Production" file="lib/rate-limit.ts" />
            <FixEntry severity="high" date="2026-02-10" title="Service-Role-Key Prefix in Response" description="Erste 10 Zeichen des Keys in debug-pipeline." fix="Durch Boolean-Flags ersetzt" file="app/api/admin/debug-pipeline/route.ts" />
            <FixEntry severity="high" date="2026-02-10" title="API-Key Logging in TTS" description="Key-Fragmente in Vercel Logs." fix="Logs auf presence-check reduziert" file="lib/tts/elevenlabs-tts.ts" />
            <FixEntry severity="high" date="2026-02-10" title="SSRF via cover-image" description="Unvalidierte URL an fetch()." fix="HTTPS + Host-Allowlist" file="app/api/newsletter/cover-image/route.ts" />
            <FixEntry severity="medium" date="2026-02-10" title="Kein Rate-Limit auf stock-quote" description="Extern-API ohne Schutz." fix="Standard Limiter (30/min)" file="app/api/stock-quote/route.ts" />
          </div>
        </Subsection>

        <div className="mt-4 rounded-lg border border-border p-4 bg-card">
          <h3 className="font-semibold mb-3 text-sm">Zusammenfassung Audit 10.02.2026</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">2</div>
              <div className="text-muted-foreground text-xs">Critical (fixed)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-500">3</div>
              <div className="text-muted-foreground text-xs">High (fixed)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-500">1</div>
              <div className="text-muted-foreground text-xs">Medium (fixed)</div>
            </div>
          </div>
        </div>
      </Section>

      {/* ============================================ */}
      {/* DATABASE SCHEMA */}
      {/* ============================================ */}
      <Section id="database" icon={<Database className="h-5 w-5" />} title="Datenbank-Übersicht">
        <Subsection title="Kerntabellen">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 pr-4">Tabelle</th>
                  <th className="text-left py-1">Zweck</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">posts / generated_posts</td><td className="py-1">Blog Posts + AI-generierte Artikel</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">daily_repo</td><td className="py-1">Gesammelte Newsletter-Artikel</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">daily_digests</td><td className="py-1">Tägliche Zusammenfassungen</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">news_queue</td><td className="py-1">Artikel-Auswahl Queue (pending→selected→used)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">synthesis_candidates</td><td className="py-1">Synthese-Kandidaten mit Scores</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">developed_syntheses</td><td className="py-1">Fertige Synthesen</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">podcast_personality_state</td><td className="py-1">Personality Dimensionen, Phasen, Moments</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">podcast_jobs</td><td className="py-1">TTS Job Queue mit Progress</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">post_podcasts</td><td className="py-1">Post → Audio URL Mapping</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">audio_files</td><td className="py-1">Intro/Outro File Library</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">stock_synthszr_cache</td><td className="py-1">AI Rating Cache (14-Tage TTL)</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">edit_history / edit_diffs</td><td className="py-1">Edit Tracking & Sentence Diffs</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">learned_patterns</td><td className="py-1">Gelernte Stilmuster mit Confidence</td></tr>
                <tr className="border-b border-border/50"><td className="py-1 pr-4 font-mono text-foreground">languages</td><td className="py-1">Aktive Locales (is_active Flag)</td></tr>
                <tr><td className="py-1 pr-4 font-mono text-foreground">newsletter_subscribers</td><td className="py-1">E-Mail Subscriber mit Status</td></tr>
              </tbody>
            </table>
          </div>
        </Subsection>
      </Section>
    </div>
  )
}

// ==========================================
// Reusable Components
// ==========================================

function TocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-muted-foreground hover:text-foreground transition-colors">
      {children}
    </a>
  )
}

function Section({ id, icon, title, children }: { id?: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-10 scroll-mt-8">
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-4 border-b border-border pb-2">
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

function FileTable({ files }: { files: [string, string][] }) {
  return (
    <div className="mt-2 rounded border border-border overflow-hidden">
      <table className="text-xs w-full">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left py-1.5 px-2 font-medium">Datei</th>
            <th className="text-left py-1.5 px-2 font-medium">Beschreibung</th>
          </tr>
        </thead>
        <tbody>
          {files.map(([file, desc]) => (
            <tr key={file} className="border-t border-border/50">
              <td className="py-1 px-2 font-mono text-muted-foreground">{file}</td>
              <td className="py-1 px-2 text-muted-foreground">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badgeColors[severity]}`}>
          {severity.toUpperCase()}
        </span>
        <span className="text-xs text-muted-foreground">{date}</span>
      </div>
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      <div className="mt-1 flex items-start gap-1">
        <span className="text-xs font-medium text-green-600">Fix:</span>
        <span className="text-xs text-muted-foreground">{fix}</span>
      </div>
      <code className="text-xs text-muted-foreground/70 font-mono">{file}</code>
    </div>
  )
}
