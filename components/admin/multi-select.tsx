'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { X } from 'lucide-react'
import { applyMultiSelect } from '@/lib/news-queue/multi-select'
import { cn } from '@/lib/utils'

export const MULTI_SELECT_ROW_CLASS =
  'bg-lime-100/70 dark:bg-lime-950/30 ring-1 ring-inset ring-lime-500/40'

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], label'

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export interface UseMultiSelectOptions {
  /** Clear selection automatically whenever this key changes (tabs, filters, pagination, date). */
  resetKey?: string
  /** Skip Escape key handling (e.g. while an edit modal is open). */
  disableEscape?: boolean
}

export interface MultiSelectState {
  selectedIds: Set<string>
  visibleSelectedIds: string[]
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  masterCheckboxRef: RefObject<HTMLInputElement | null>
  isSelected: (id: string) => boolean
  toggle: (id: string, shiftKey?: boolean) => void
  toggleAll: () => void
  clear: () => void
  rowSelectionProps: (
    id: string,
    onNormalClick?: () => void,
  ) => {
    onMouseDown: (e: MouseEvent<HTMLElement>) => void
    onClick: (e: MouseEvent<HTMLElement>) => void
  }
}

export function useMultiSelect(
  visibleIds: readonly string[],
  options?: UseMultiSelectOptions,
): MultiSelectState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const anchorIdRef = useRef<string | null>(null)
  const masterCheckboxRef = useRef<HTMLInputElement | null>(null)
  const visibleIdsArray = useMemo(() => Array.from(visibleIds), [visibleIds])

  const resetKey = options?.resetKey
  const disableEscape = options?.disableEscape ?? false

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    anchorIdRef.current = null
  }, [])

  useEffect(() => {
    if (resetKey === undefined) return
    clear()
  }, [resetKey, clear])

  const visibleSelectedIds = useMemo(
    () => visibleIdsArray.filter((id) => selectedIds.has(id)),
    [visibleIdsArray, selectedIds],
  )

  const allVisibleSelected =
    visibleIdsArray.length > 0 && visibleSelectedIds.length === visibleIdsArray.length
  const someVisibleSelected =
    visibleSelectedIds.length > 0 && !allVisibleSelected

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = someVisibleSelected
    }
  }, [someVisibleSelected])

  useEffect(() => {
    if (disableEscape || selectedIds.size === 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isEditableElement(e.target)) return
      clear()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disableEscape, selectedIds.size, clear])

  const toggle = useCallback(
    (id: string, shiftKey = false) => {
      setSelectedIds((prev) => {
        const result = applyMultiSelect({
          visibleIds: visibleIdsArray,
          selected: prev,
          anchorId: anchorIdRef.current,
          clickedId: id,
          shiftKey,
        })
        anchorIdRef.current = result.anchorId
        return result.selected
      })
    },
    [visibleIdsArray],
  )

  const toggleAll = useCallback(() => {
    if (allVisibleSelected) {
      clear()
      return
    }
    setSelectedIds(new Set(visibleIdsArray))
    anchorIdRef.current = visibleIdsArray[0] ?? null
  }, [allVisibleSelected, visibleIdsArray, clear])

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const rowSelectionProps = useCallback(
    (id: string, onNormalClick?: () => void) => ({
      onMouseDown: (e: MouseEvent<HTMLElement>) => {
        if (e.shiftKey) e.preventDefault()
      },
      onClick: (e: MouseEvent<HTMLElement>) => {
        const target = e.target as HTMLElement | null
        if (target?.closest(INTERACTIVE_SELECTOR)) return
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault()
          toggle(id, e.shiftKey)
          return
        }
        onNormalClick?.()
      },
    }),
    [toggle],
  )

  return {
    selectedIds,
    visibleSelectedIds,
    allVisibleSelected,
    someVisibleSelected,
    masterCheckboxRef,
    isSelected,
    toggle,
    toggleAll,
    clear,
    rowSelectionProps,
  }
}

export interface MultiSelectCheckboxProps {
  checked: boolean
  onToggle: (shiftKey: boolean) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
}

export function MultiSelectCheckbox({
  checked,
  onToggle,
  disabled = false,
  ariaLabel,
  className,
}: MultiSelectCheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) onToggle(e.shiftKey)
      }}
      onChange={() => {}}
      aria-label={ariaLabel}
      className={cn(
        'h-3.5 w-3.5 rounded border-muted-foreground/40 accent-zinc-900 dark:accent-lime-400 cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    />
  )
}

export interface MultiSelectBarProps {
  selection: MultiSelectState
  totalVisible: number
  busy?: boolean
  className?: string
  children?: ReactNode
}

export function MultiSelectBar({
  selection,
  totalVisible,
  busy = false,
  className,
  children,
}: MultiSelectBarProps) {
  if (totalVisible === 0) return null

  const count = selection.visibleSelectedIds.length

  if (count === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border bg-muted/20 text-[11px] text-muted-foreground',
          className,
        )}
      >
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            ref={selection.masterCheckboxRef}
            type="checkbox"
            checked={false}
            onChange={selection.toggleAll}
            disabled={busy}
            className="h-3.5 w-3.5 rounded border-muted-foreground/40 accent-zinc-900 cursor-pointer"
          />
          <span>Alle auswählen ({totalVisible})</span>
        </label>
        <span className="hidden sm:inline">Checkbox oder Shift+Klick für Mehrfachauswahl</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 px-3 py-2 rounded-md border border-lime-500/60 bg-lime-50/90 dark:bg-lime-950/30',
        className,
      )}
    >
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          ref={selection.masterCheckboxRef}
          type="checkbox"
          checked={selection.allVisibleSelected}
          onChange={selection.toggleAll}
          disabled={busy}
          className="h-3.5 w-3.5 rounded border-zinc-900 accent-zinc-900 cursor-pointer"
        />
        <span className="text-xs font-semibold">{count} ausgewählt</span>
      </label>

      <button
        type="button"
        onClick={selection.clear}
        disabled={busy}
        className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-black/5 disabled:opacity-50"
        title="Auswahl aufheben (Esc)"
      >
        <X className="h-3 w-3" />
        Aufheben
      </button>

      {children && (
        <>
          <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
          <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        </>
      )}
    </div>
  )
}
