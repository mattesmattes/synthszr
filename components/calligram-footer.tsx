'use client'

import { useCallback } from 'react'
import { CalligramCanvas, generateTextPositions } from './calligram-canvas'

const WORD = 'OH-SO '
const CHAR_SIZE = 4
const TEXT_W = 600
const TEXT_H = 120

export function CalligramFooter() {
  const textGen = useCallback(
    () => generateTextPositions('synthszr', TEXT_W, TEXT_H, WORD, CHAR_SIZE),
    []
  )

  return (
    <div className="flex justify-center -mt-6 pb-2">
      <CalligramCanvas
        width={TEXT_W}
        height={TEXT_H}
        word={WORD}
        fontSize={CHAR_SIZE}
        generateFn={textGen}
      />
    </div>
  )
}
