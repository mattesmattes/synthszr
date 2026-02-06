/**
 * GET /api/podcast/jobs/[jobId]
 * Get status of a specific podcast generation job
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/session'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const authError = await requireAdmin(request)
  if (authError) return authError

  const { jobId } = await params
  const supabase = await createClient()

  const { data: job, error } = await supabase
    .from('podcast_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentLine: job.current_line,
    totalLines: job.total_lines,
    audioUrl: job.audio_url,
    segmentUrls: job.segment_urls,
    segmentMetadata: job.segment_metadata,
    durationSeconds: job.duration_seconds,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  })
}
