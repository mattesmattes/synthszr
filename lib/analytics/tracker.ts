export function trackEvent(
  eventType: 'page_view' | 'stock_ticker_click' | 'synthszr_vote_click' | 'podcast_play',
  options?: { company?: string; locale?: string }
) {
  if (typeof window === 'undefined') return
  const payload = JSON.stringify({ eventType, path: window.location.pathname, ...options })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/event', new Blob([payload], { type: 'application/json' }))
    } else {
      fetch('/api/track/event', {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // silent — tracking never blocks UX
  }
}
