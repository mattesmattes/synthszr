import { getSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/admin/admin-shell'

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  const session = await getSession()

  if (!session?.isAdmin) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-background" style={{ fontFamily: 'var(--font-sf-pro)' }}>
      {/* Seitenleiste + Inhalt: die Shell hält den Ein-/Ausklappzustand (Client), das Layout bleibt Server für die Auth-Prüfung */}
      <AdminShell>{children}</AdminShell>
    </div>
  )
}
