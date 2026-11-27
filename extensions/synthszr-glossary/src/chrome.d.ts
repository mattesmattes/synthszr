// Minimal MV3 Chrome Extension & modern CSS Highlight API type declarations
// so the extension compiles strictly without external @types/chrome dependencies.

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab
      frameId?: number
      url?: string
    }
    const id: string
    function sendMessage<T = unknown>(message: unknown): Promise<T>
    function getURL(path: string): string
    const onInstalled: {
      addListener(cb: (details: { reason: string }) => void): void
    }
    const onStartup: {
      addListener(cb: () => void): void
    }
    const onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown
      newValue?: unknown
    }
    interface StorageArea {
      get<T = Record<string, unknown>>(keys?: string | string[] | null): Promise<T>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string | string[]): Promise<void>
    }
    const local: StorageArea
    const sync: StorageArea
    const onChanged: {
      addListener(cb: (changes: Record<string, StorageChange>, areaName: string) => void): void
    }
  }

  namespace alarms {
    interface Alarm {
      name: string
      scheduledTime: number
      periodInMinutes?: number
    }
    function create(name: string, alarmInfo: { delayInMinutes?: number; periodInMinutes?: number }): Promise<void> | void
    function get(name: string): Promise<Alarm | undefined>
    const onAlarm: {
      addListener(cb: (alarm: Alarm) => void): void
    }
  }

  namespace tabs {
    interface Tab {
      id?: number
      url?: string
    }
    function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>
    function create(createProperties: { url: string }): Promise<Tab>
  }
}

interface Highlight extends Set<AbstractRange> {
  priority: number
  type: 'highlight' | 'spelling-error' | 'grammar-error'
}

declare var Highlight: {
  prototype: Highlight
  new (...initialRanges: AbstractRange[]): Highlight
}

interface HighlightRegistry extends Map<string, Highlight> {}

interface CSSNamespace {
  highlights?: HighlightRegistry
}

declare var CSS: CSSNamespace & {
  highlights?: HighlightRegistry
}

interface CaretPosition {
  readonly offsetNode: Node
  readonly offset: number
}

interface Document {
  caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}
