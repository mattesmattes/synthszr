import { NextResponse } from 'next/server'
import { getMentionSourceText } from '@/lib/rankings/product-detail'

// Quellen-Volltext für den Dialog der Produktseite, auf Klick statt im
// Seiten-Render (Egress-Befund 2026-09-19, s. getProductDetail).
//
// ISR per Pfad-Segment statt ?id=: Texte vergangener Newsletter ändern sich
// nicht, ein Tag am Edge reicht. Bewusst OHNE Rate-Limit — das bräuchte die
// Client-IP, macht die Route dynamisch und kostet den Edge-Cache (vgl.
// api/rankings/products). Ein Cache-Miss ist eine einzelne kleine Query.
export const revalidate = 86400

// Leeres generateStaticParams aktiviert on-demand ISR (wie bei den
// Produktseiten, s. app/[lang]/rankings/[slug]/page.tsx).
export async function generateStaticParams() {
  return []
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  // DB-Fehler NICHT abfangen: eine geworfene Revalidierung behält die alte
  // Antwort, eine zurückgegebene 500 läge dagegen einen Tag im Cache.
  const content = await getMentionSourceText(id)
  if (content === undefined) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ content })
}
