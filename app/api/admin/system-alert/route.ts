import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/session'
import { getActiveSystemAlert, dismissSystemAlert } from '@/lib/alerts/system-alert'

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError
  const alert = await getActiveSystemAlert()
  return NextResponse.json({ alert })
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError
  await dismissSystemAlert()
  return NextResponse.json({ success: true })
}
