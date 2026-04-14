export type AdPromoLayout = 'grid' | 'single'
export type BlendMode = 'normal' | 'multiply'

export interface AdPromo {
  id: string
  name: string
  layout: AdPromoLayout
  image_left_url: string | null
  image_left_bg: string
  image_left_blend: BlendMode
  image_right_url: string | null
  image_right_bg: string
  image_right_blend: BlendMode
  text_bg: string
  text_color: string
  eyebrow: string | null
  title: string
  body: string
  cta_label: string
  link_url: string
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface AdPromoConfig {
  mode: 'constant' | 'rotate'
  constantId: string | null
}
