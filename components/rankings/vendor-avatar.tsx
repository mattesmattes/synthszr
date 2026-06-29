// Vendor-Icon: echtes Hersteller-Favicon (Google-Favicon-Service) mit
// Vendor→Domain-Mapping; Initial+Farbe nur als Fallback für unbekannte Vendoren.

const VENDOR_DOMAINS: Record<string, string> = {
  openai: 'openai.com', anthropic: 'anthropic.com', google: 'google.com',
  xai: 'x.ai', deepseek: 'deepseek.com', meta: 'meta.com', microsoft: 'microsoft.com',
  mistral: 'mistral.ai', alibaba: 'alibabacloud.com', qwen: 'alibabacloud.com',
  anysphere: 'cursor.com', cursor: 'cursor.com', perplexity: 'perplexity.ai',
  midjourney: 'midjourney.com', runway: 'runwayml.com', elevenlabs: 'elevenlabs.io',
  'sakana-ai': 'sakana.ai', 'z-ai': 'z.ai', zhipu: 'z.ai', cohere: 'cohere.com',
  nvidia: 'nvidia.com', apple: 'apple.com', amazon: 'amazon.com', aws: 'aws.amazon.com',
  stability: 'stability.ai', 'stability-ai': 'stability.ai', huggingface: 'huggingface.co',
  github: 'github.com', figma: 'figma.com', notion: 'notion.so', kuaishou: 'kuaishou.com',
  ibm: 'ibm.com', salesforce: 'salesforce.com', adobe: 'adobe.com', tencent: 'tencent.com',
  bytedance: 'bytedance.com', moonshot: 'moonshot.cn', baidu: 'baidu.com', minimax: 'minimaxi.com',
}

const PALETTE = [
  '#0f3460', '#533483', '#1b4332', '#264653', '#6a040f',
  '#3a0ca3', '#1a1a2e', '#5c3d2e', '#14213d', '#7f5539',
]

function colorFor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Bekannte Vendor-Domain (echtes Favicon) oder Heuristik; null → Initial-Fallback. */
function domainFor(vendor: string): string | null {
  const v = vendor.trim().toLowerCase()
  if (!v || v === 'unknown') return null
  if (VENDOR_DOMAINS[v]) return VENDOR_DOMAINS[v]
  if (v.endsWith('-ai')) return v.slice(0, -3).replace(/[^a-z0-9]/g, '') + '.ai'
  const clean = v.replace(/[^a-z0-9]/g, '')
  return clean.length >= 3 ? `${clean}.com` : null
}

export function VendorAvatar({ vendor, size = 40 }: { vendor: string; size?: number }) {
  const domain = domainFor(vendor)
  if (domain) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt={vendor}
        width={size}
        height={size}
        loading="lazy"
        className="rounded-lg shrink-0 bg-white object-contain border border-gray-100 p-0.5"
      />
    )
  }
  const initial = (vendor.trim()[0] ?? '?').toUpperCase()
  return (
    <div
      aria-hidden
      style={{ width: size, height: size, background: colorFor(vendor || '?'), fontSize: size * 0.42 }}
      className="rounded-lg flex items-center justify-center text-white font-bold shrink-0 select-none"
    >
      {initial}
    </div>
  )
}
