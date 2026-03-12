import { NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { type NodeViewProps } from '@tiptap/react'
import { VALID_CATEGORIES, LATIN_CATEGORIES } from '@/lib/data/categories'

export function HeadingNodeView({ node, updateAttributes }: NodeViewProps) {
  const level = node.attrs.level as number
  const category = node.attrs.category as string | null

  // Only H2 gets a category selector
  if (level !== 2) {
    const Tag = `h${level}` as 'h1' | 'h3' | 'h4' | 'h5' | 'h6'
    return (
      <NodeViewWrapper as={Tag}>
        <NodeViewContent />
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper>
      <div contentEditable={false} style={{ userSelect: 'none' }}>
        <select
          value={category || ''}
          onChange={(e) => updateAttributes({ category: e.target.value || null })}
          style={{
            fontSize: '10px',
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            background: category ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.15)',
            color: category ? '#fff' : '#888',
            border: 'none',
            borderRadius: '3px',
            padding: '2px 6px',
            cursor: 'pointer',
            outline: 'none',
            marginBottom: '4px',
            display: 'inline-block',
          }}
        >
          <option value="">— Keine Kategorie —</option>
          {VALID_CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{LATIN_CATEGORIES[cat]}</option>
          ))}
        </select>
      </div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <NodeViewContent as={'h2' as any} />
    </NodeViewWrapper>
  )
}
