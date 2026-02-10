import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getSession } from '@/lib/auth/session'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await getSession()
        if (!session) {
          throw new Error('Nicht autorisiert')
        }

        return {
          allowedContentTypes: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave'],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
        }
      },
      onUploadCompleted: async ({ blob }) => {
        // DB insert happens client-side after upload
        console.log(`[AudioFiles] Blob upload completed: ${blob.url}`)
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
