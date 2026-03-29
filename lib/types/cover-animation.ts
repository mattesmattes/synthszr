export type CoverAnimationMode = 'static_svg' | 'calligram'

export type CoverAnimationShape =
  | 'heart' | 'circle' | 'star' | 'wave' | 'spiral'
  | 'custom_text' | 'custom_image'

export interface CalligramConfig {
  word: string
  fontSize: number
  color: string // hex or '' for default grey gradient
  width: number
  height: number
  shape: CoverAnimationShape
  shapeText?: string
  shapeImageUrl?: string
  holdDuration: number
}

export interface CoverAnimationConfig {
  mode: CoverAnimationMode
  calligram: CalligramConfig
}

export const DEFAULT_COVER_ANIMATION_CONFIG: CoverAnimationConfig = {
  mode: 'static_svg',
  calligram: {
    word: 'OH-SO ',
    fontSize: 7,
    color: '',
    width: 600,
    height: 120,
    shape: 'custom_text',
    shapeText: 'synthszr',
    holdDuration: 3,
  },
}
