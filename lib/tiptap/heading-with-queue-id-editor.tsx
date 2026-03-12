import { ReactNodeViewRenderer } from '@tiptap/react'
import { HeadingWithQueueId } from './heading-with-queue-id'
import { HeadingNodeView } from '@/components/heading-node-view'

/**
 * Editor-only extension that adds a React NodeView for category editing.
 * Extends HeadingWithQueueId with a dropdown selector on H2 headings.
 *
 * Use this in editor components (tiptap-editor, tiptap-editor-with-patterns).
 * For server-side/headless usage (generateJSON, renderer), use HeadingWithQueueId directly.
 */
export const HeadingWithQueueIdEditor = HeadingWithQueueId.extend({
  addNodeView() {
    return ReactNodeViewRenderer(HeadingNodeView)
  },
})
