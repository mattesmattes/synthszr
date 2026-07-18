import { describe, expect, it } from 'vitest'
import { toPipelineItem } from '@/lib/article-jobs/service'

describe('NewsQueueItem → PipelineItem', () => {
  it('überträgt bundle_type', () => {
    const nq = { id: '1', title: 'T', content: 'C', source_url: null, source_identifier: 's', source_display_name: null, bundle_type: 'topic' } as any
    expect(toPipelineItem(nq).bundle_type).toBe('topic')
  })
  it('normal → null/undefined', () => {
    const nq = { id: '1', title: 'T', content: 'C', source_url: null, source_identifier: 's', source_display_name: null, bundle_type: null } as any
    expect(toPipelineItem(nq).bundle_type ?? null).toBeNull()
  })
})
