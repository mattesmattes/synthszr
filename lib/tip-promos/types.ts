export interface TipPromo {
  id: string
  name: string
  headline: string
  body: string
  link_url: string
  cta_label: string
  gradient_from: string
  gradient_to: string
  gradient_direction: string
  text_color: string
  active: boolean
  sort_order: number
  type: 'static' | 'podcast'
  created_at: string
  updated_at: string
  // Render-time enrichment for type='podcast' (set by getActiveTipPromo):
  podcast?: {
    episodeTitle: string | null
    episodeSubtitle: string | null
    appleUrl: string | null // per-episode Apple Podcasts deep link; Spotify stays show-level
  }
}

export interface TipPromoConfig {
  mode: 'constant' | 'rotate' | 'off'
  constantId: string | null
}
