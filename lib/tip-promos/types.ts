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
  created_at: string
  updated_at: string
}

export interface TipPromoConfig {
  mode: 'constant' | 'rotate'
  constantId: string | null
}
