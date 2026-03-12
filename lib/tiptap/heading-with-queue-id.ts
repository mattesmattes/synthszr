import Heading from '@tiptap/extension-heading'

/**
 * Custom Heading extension that preserves the queueItemId attribute
 *
 * This extension extends TipTap's Heading to include a queueItemId attribute
 * on H2 headings. This ID links the heading to its source queue item,
 * allowing thumbnails to be matched to articles even after users reorder them.
 *
 * Usage:
 * Replace StarterKit.configure({ heading: false }) and add HeadingWithQueueId separately
 */
export const HeadingWithQueueId = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      queueItemId: {
        default: null,
        parseHTML: element => element.getAttribute('data-queue-item-id'),
        renderHTML: attributes => {
          if (!attributes.queueItemId) {
            return {}
          }
          return {
            'data-queue-item-id': attributes.queueItemId,
          }
        },
      },
    }
  },
})
