import { verifyBearerToken } from '@/lib/security/cron-auth'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/auth/session'
import { prepareAnalysisInput, streamAnalysis } from '@/lib/analysis/processor'

export const runtime = 'nodejs'
export const maxDuration = 800

export async function POST(request: NextRequest) {
  const session = await getSession()
  const authHeader = request.headers.get('authorization')
  const cronSecretValid = verifyBearerToken(authHeader, process.env.CRON_SECRET)

  if (!session && !cronSecretValid) {
    return new Response(JSON.stringify({ error: 'Nicht autorisiert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const { date, promptId } = body

    // IMMER der Admin-Client — der Fall, den der frühere Kommentar hier
    // vorhergesagt hat ("if that ever changes, switch to createAdminClient()
    // unconditionally"), ist eingetreten: seit dem RLS-Umbau darf der anon-Key
    // daily_repo nicht mehr lesen. Gemessen 2026-08-23 für denselben Tag:
    // service_role 677 Zeilen, anon 0 Zeilen — und PostgREST meldet das als
    // HTTP 200 mit leerem Ergebnis, nicht als Fehler. Die Analyse lief damit
    // über den Cron einwandfrei und scheiterte im Panel mit "Keine Inhalte für
    // dieses Datum gefunden", obwohl 677 Einträge dastanden.
    //
    // Sicher ist das, weil die Berechtigung oben bereits geprüft wurde: hierher
    // kommt nur, wer eine Admin-Session ODER das Cron-Secret hat. Dasselbe
    // Muster nutzen die übrigen Admin-Routen (z. B. api/admin/translations).
    const supabase = createAdminClient()
    const prepared = await prepareAnalysisInput(
      supabase as unknown as ReturnType<typeof createAdminClient>,
      date,
      promptId
    )

    if (!prepared.ok) {
      return new Response(JSON.stringify({ error: prepared.error }), {
        status: prepared.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { fullContent, processedItemIds, promptText } = prepared.data

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'sources',
            itemIds: processedItemIds,
          })}\n\n`))

          for await (const chunk of streamAnalysis(fullContent, promptText)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`))
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Analyse fehlgeschlagen' })}\n\n`
            )
          )
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Analysis error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Analyse fehlgeschlagen' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
