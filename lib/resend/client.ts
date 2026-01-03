import { Resend } from 'resend'

// Lazy initialization to avoid build-time errors
let _resend: Resend | null = null

export function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured')
    }
    _resend = new Resend(apiKey)
  }
  return _resend
}

// Absender-E-Mail - mit Resend's Test-Domain oder eigener verifizierter Domain
export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Synthszr <onboarding@resend.dev>'

// Base URL für Links in E-Mails
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://synthszr.vercel.app'
