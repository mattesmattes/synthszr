import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeVendorNamespace } from '@/lib/rankings/resolve-product-payload'
import { VendorAvatar } from './vendor-avatar'

/** "Produkte in den Synthszr Charts" auf Company-Seiten — schließt das
 *  bisher einseitige Silo (Produktseite → Company, aber nie zurück). */
export async function VendorProducts({
  lang,
  vendor,
  heading,
}: {
  lang: string
  vendor: string
  heading: string
}) {
  const ns = normalizeVendorNamespace(vendor)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('product_metrics')
    .select('momentum, mention_count, products!inner(canonical_name, vendor_namespace, slug)')
    .eq('chartable', true)
    .eq('products.vendor_namespace', ns)
    .gte('mention_count', 2)
    .order('momentum', { ascending: false })
    .limit(12)
  if (error || !data?.length) return null

  const items = data.map((r) => {
    const p = (Array.isArray(r.products) ? r.products[0] : r.products) as {
      canonical_name: string
      vendor_namespace: string
      slug: string
    }
    return { name: p.canonical_name, vendor: p.vendor_namespace, slug: p.slug }
  })

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold mb-3">{heading}</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((x) => (
          <li key={x.slug}>
            <Link
              href={`/${lang}/rankings/${x.slug}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm transition-colors hover:border-black"
            >
              <VendorAvatar vendor={x.vendor} size={20} />
              <span className="font-medium">{x.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
