import 'dotenv/config'
import { resetStuckSelectedItems, syncPublishedPostsQueueItems, getQueueStats } from '../lib/news-queue/service'

async function main() {
  console.log('=== Queue Cleanup ===\n')
  
  // Get current stats
  console.log('Before cleanup:')
  const before = await getQueueStats()
  console.log(before)
  
  // Reset stuck selected items (older than 24h)
  console.log('\n--- Resetting stuck selected items (>24h) ---')
  const resetCount = await resetStuckSelectedItems(24)
  console.log(`Reset ${resetCount} items`)
  
  // Sync published posts
  console.log('\n--- Syncing published posts queue items ---')
  const syncResult = await syncPublishedPostsQueueItems()
  console.log(`Processed ${syncResult.processed} posts, marked ${syncResult.itemsMarked} items as used`)
  
  // Get final stats
  console.log('\nAfter cleanup:')
  const after = await getQueueStats()
  console.log(after)
}

main().catch(console.error)
