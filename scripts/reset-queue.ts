import { createAdminClient } from '../lib/supabase/admin'

async function resetQueue() {
  const supabase = createAdminClient()
  
  // Delete all pending and selected items
  const { data: deleted, error } = await supabase
    .from('news_queue')
    .delete()
    .in('status', ['pending', 'selected'])
    .select('id')
  
  if (error) {
    console.error('Error:', error)
    return
  }
  
  console.log('Deleted', deleted?.length || 0, 'items (pending + selected)')
  
  // Verify
  const { data: remaining } = await supabase
    .from('news_queue')
    .select('status')
  
  const stats: Record<string, number> = { pending: 0, selected: 0, used: 0, other: 0 }
  remaining?.forEach(item => {
    if (item.status in stats) stats[item.status]++
    else stats.other++
  })
  console.log('Remaining:', stats)
}
resetQueue()
