'use client'

import { useCallback } from 'react'
import { CalligramCanvas, createGenerateFn } from './calligram-canvas'
import type { CalligramConfig } from '@/lib/types/cover-animation'

export function CoverCalligram(config: CalligramConfig) {
  const generateFn = useCallback(
    () => createGenerateFn(config)(),
    [config]
  )

  return (
    <CalligramCanvas
      width={config.width}
      height={config.height}
      word={config.word}
      fontSize={config.fontSize}
      color={config.color || undefined}
      holdDuration={config.holdDuration}
      generateFn={generateFn}
      style={{ width: '100%', height: 'auto', aspectRatio: `${config.width}/${config.height}` }}
      className="max-w-full"
    />
  )
}
