import { Mark, mergeAttributes } from '@tiptap/core'

export interface PatternHighlightOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    patternHighlight: {
      /**
       * Set a pattern highlight mark
       */
      setPatternHighlight: (attributes: {
        patternId: string
        originalForm?: string
        preferredForm?: string
        confidence?: number
      }) => ReturnType
      /**
       * Toggle a pattern highlight mark
       */
      togglePatternHighlight: (attributes: {
        patternId: string
        originalForm?: string
        preferredForm?: string
        confidence?: number
      }) => ReturnType
      /**
       * Unset a pattern highlight mark
       */
      unsetPatternHighlight: () => ReturnType
    }
  }
}

export const PatternHighlightMark = Mark.create<PatternHighlightOptions>({
  name: 'patternHighlight',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      patternId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-pattern-id'),
        renderHTML: (attributes) => {
          if (!attributes.patternId) return {}
          return { 'data-pattern-id': attributes.patternId }
        },
      },
      originalForm: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-form'),
        renderHTML: (attributes) => {
          if (!attributes.originalForm) return {}
          return { 'data-original-form': attributes.originalForm }
        },
      },
      preferredForm: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-preferred-form'),
        renderHTML: (attributes) => {
          if (!attributes.preferredForm) return {}
          return { 'data-preferred-form': attributes.preferredForm }
        },
      },
      confidence: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-confidence')
          return value ? parseFloat(value) : null
        },
        renderHTML: (attributes) => {
          if (attributes.confidence == null) return {}
          return { 'data-confidence': attributes.confidence.toString() }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-pattern-highlight]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-pattern-highlight': '',
        class: 'pattern-highlight',
        style:
          'background-color: rgba(250, 204, 21, 0.3); border-bottom: 2px solid rgb(250, 204, 21); cursor: help;',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setPatternHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      togglePatternHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes)
        },
      unsetPatternHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },
})
