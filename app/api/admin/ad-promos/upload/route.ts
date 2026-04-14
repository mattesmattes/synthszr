import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = await getSession()
        if (!session) throw new Error('Nicht autorisiert')
        return {
          allowedContentTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'],
          maximumSizeInBytes: 8 * 1024 * 1024,
        }
      },
      onUploadCompleted: async ({ blob }) => {
        console.log(`[AdPromo] Image uploaded: ${blob.url}`)
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload error' },
      { status: 400 },
    )
  }
}
