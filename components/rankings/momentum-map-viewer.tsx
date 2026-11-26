'use client'

import { useState } from 'react'
import { Download, Printer, ZoomIn, ZoomOut } from 'lucide-react'
import type { MomentumMapData } from '@/lib/rankings/momentum-map'
import { MomentumMapPoster } from '@/components/rankings/momentum-map-poster'

export function MomentumMapViewer({ data, locale }: { data: MomentumMapData; locale: string }) {
  const [zoomed, setZoomed] = useState(false)
  const de = locale === 'de'
  const slug = data.monthLabel.toLowerCase().replace(/\s+/g, '-')

  function handleDownloadSvg() {
    const svg = document.getElementById('synthszr-momentum-map-svg')
    if (!svg) return
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}`
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `synthszr-momentum-map-${slug}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handlePrintPdf() {
    window.print()
  }

  return (
    <div>
      {/* Print stylesheet: prints ONLY the A2 SVG poster edge-to-edge at exact DIN A2 */}
      <style>{`
        @media print {
          @page { size: 420mm 594mm; margin: 0; }
          body * { visibility: hidden !important; }
          #poster-print-root, #poster-print-root * { visibility: visible !important; }
          #poster-print-root {
            position: fixed !important;
            inset: 0 !important;
            width: 420mm !important;
            height: 594mm !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
          }
          #poster-print-root svg {
            width: 420mm !important;
            height: 594mm !important;
          }
        }
      `}</style>

      {/* Toolbar (hidden when printing) */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3 print:hidden">
        <div className="space-y-0.5">
          <div className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
            SYNTHSZR MOMENTUM MAP · {data.monthLabel} ({data.issueCode})
          </div>
          <p className="text-xs text-muted-foreground">
            {de
              ? `DIN A2 Vektor-Poster (420 × 594 mm) · ${data.totalMentions90d.toLocaleString('de-DE')} Erwähnungen in 90 Tagen · 16 Kategorien × Top 5`
              : `DIN A2 Vector Poster (420 × 594 mm) · ${data.totalMentions90d.toLocaleString('en-US')} mentions over 90 days · 16 categories × Top 5`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs hover:bg-secondary"
          >
            {zoomed ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
            {zoomed ? (de ? 'Einpassen' : 'Fit') : (de ? '100% Zoom' : '100% Zoom')}
          </button>
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" />
            SVG
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="inline-flex items-center gap-1.5 rounded-md border border-foreground bg-[#CCFF00] px-3 py-1.5 font-mono text-xs font-semibold text-black hover:brightness-95"
          >
            <Printer className="h-3.5 w-3.5" />
            {de ? 'A2 PDF drucken' : 'Print A2 PDF'}
          </button>
        </div>
      </div>

      {/* Poster Gallery Canvas */}
      <div className={zoomed ? 'overflow-x-auto pb-6' : ''}>
        <div
          id="poster-print-root"
          className={`mx-auto overflow-hidden rounded-sm border border-border bg-[#F6F5F0] shadow-xl ${
            zoomed ? 'w-[1260px]' : 'max-w-[960px]'
          }`}
        >
          <MomentumMapPoster data={data} />
        </div>
      </div>
    </div>
  )
}
