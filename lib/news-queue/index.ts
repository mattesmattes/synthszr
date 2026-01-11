/**
 * News Queue Module
 * Provides source-diversified news selection for article generation
 */

export {
  // Service functions
  addToQueue,
  queueFromDailyRepo,
  getSourceDistribution,
  getSelectableItems,
  getBalancedSelection,
  selectItemsForArticle,
  markItemsAsUsed,
  skipItems,
  expireOldItems,
  getQueueStats,
  updateScores,
  getItemsBySource,
  wouldViolateSourceLimit,
  clearPendingQueue,
  resetSelectedToPending,
  // Helper functions
  normalizeSourceIdentifier,
  extractSourceDisplayName,
} from './service'
