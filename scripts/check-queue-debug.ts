import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  // Queue stats
  const { data: queueData, error: queueError } = await supabase.from('news_queue').select('status');
  if (queueError) {
    console.error('Queue error:', queueError);
    return;
  }
  
  const stats: Record<string, number> = { pending: 0, selected: 0, used: 0, other: 0 };
  queueData?.forEach(item => { 
    if (stats[item.status] !== undefined) stats[item.status]++; 
    else stats.other++;
  });
  console.log('Queue stats:', stats);

  // Check posts with pending_queue_item_ids
  const { data: posts, error: postsError } = await supabase
    .from('generated_posts')
    .select('id, title, status, pending_queue_item_ids')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (postsError) {
    console.error('Posts error:', postsError);
    return;
  }
  
  console.log('\nRecent posts:');
  posts?.forEach(p => {
    const ids = p.pending_queue_item_ids || [];
    const titlePreview = p.title ? p.title.slice(0,50) : 'no title';
    console.log('  - [' + p.status + '] ' + titlePreview + '... queue_ids: ' + ids.length);
  });
}
check();
