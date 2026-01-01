import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const SESSION_COOKIE_NAME = 'synthszr_session'

// Routes that require authentication
const protectedRoutes = ['/admin']

// Routes that should redirect to admin if already logged in
const authRoutes = ['/login']

function getSecretKey() {
  // Use JWT_SECRET if available, fallback to ADMIN_PASSWORD for backwards compatibility
  const secret = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD
  if (!secret) {
    throw new Error('JWT_SECRET or ADMIN_PASSWORD environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecretKey())
    return true
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value

  const isAuthenticated = sessionToken ? await verifyToken(sessionToken) : false

  // Check if trying to access protected route
  const isProtectedRoute = protectedRoutes.some(route =>
    pathname.startsWith(route)
  )

  // Check if trying to access auth route (login)
  const isAuthRoute = authRoutes.some(route =>
    pathname.startsWith(route)
  )

  // Redirect to login if accessing protected route without auth
  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect to admin if accessing login while already authenticated
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/admin', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match all admin routes
    '/admin/:path*',
    // Match login route
    '/login'
  ]
}
