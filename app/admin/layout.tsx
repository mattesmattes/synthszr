import { getSession } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

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
      <AdminSidebar />

      {/* Main Content — pt-14 on mobile for fixed header, ml-64 on desktop for sidebar */}
      <main className="flex-1 pt-14 md:pt-0 md:ml-64">
        {children}
      </main>
    </div>
  )
}
