/**
 * POST /api/podcast/jobs
 * Create a new podcast generation job (returns immediately with job ID)
 *
 * GET /api/podcast/jobs
 * List recent jobs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'
import { parseScriptText, type PodcastLine } from '@/lib/tts/elevenlabs-tts'

interface CreateJobRequest {
  script: string | PodcastLine[]
  hostVoiceId: string
  guestVoiceId: string
  provider?: 'elevenlabs' | 'openai'
  model?: string
  title?: string
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  try {
    const body: CreateJobRequest = await request.json()

    if (!body.script) {
      return NextResponse.json({ error: 'Script is required' }, { status: 400 })
    }

    // Parse script if string
    let lines: PodcastLine[]
    let scriptText: string

    if (typeof body.script === 'string') {
      lines = parseScriptText(body.script)
      scriptText = body.script
    } else {
      lines = body.script
      scriptText = lines.map(l => `${l.speaker}: ${l.text}`).join('\n')
    }

    if (lines.length === 0) {
      return NextResponse.json(
        { error: 'Script has no valid dialogue lines' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Create job
    const { data: job, error } = await supabase
      .from('podcast_jobs')
      .insert({
        script: scriptText,
        host_voice_id: body.hostVoiceId,
        guest_voice_id: body.guestVoiceId,
        provider: body.provider || 'elevenlabs',
        model: body.model,
        title: body.title,
        total_lines: lines.length,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      console.error('[Podcast Jobs] Failed to create job:', error)
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 })
    }

    console.log(`[Podcast Jobs] Created job ${job.id} with ${lines.length} lines`)

    // Note: Processing is triggered by the client calling /api/podcast/jobs/process

    return NextResponse.json({
      success: true,
      jobId: job.id,
      totalLines: lines.length,
      estimatedSeconds: lines.length * 5, // ~5s per line
    })
  } catch (error) {
    console.error('[Podcast Jobs] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const supabase = await createClient()

  const { data: jobs, error } = await supabase
    .from('podcast_jobs')
    .select('id, status, progress, current_line, total_lines, audio_url, duration_seconds, error_message, created_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }

  return NextResponse.json({ jobs })
}
