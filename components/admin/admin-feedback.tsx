'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Toaster } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (options: string | ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  return useCallback(
    (options: string | ConfirmOptions) => {
      if (ctx) return ctx(options)
      const msg = typeof options === 'string'
        ? options
        : options.description
        ? `${options.title}\n\n${options.description}`
        : options.title
      return Promise.resolve(window.confirm(msg))
    },
    [ctx],
  )
}

function useHtmlDarkClass(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const el = document.documentElement
    const update = () => setTheme(el.classList.contains('dark') ? 'dark' : 'light')
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return theme
}

export function AdminFeedbackProvider({ children }: { children: ReactNode }) {
  const theme = useHtmlDarkClass()
  const [state, setState] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm: ConfirmFn = useCallback((options) => {
    const normalized: ConfirmOptions =
      typeof options === 'string'
        ? { title: options, destructive: true }
        : options

    if (resolverRef.current) {
      resolverRef.current(false)
      resolverRef.current = null
    }

    setState(normalized)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const finish = useCallback((result: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setState(null)
    resolve?.(result)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Toaster
        theme={theme}
        richColors
        position="bottom-right"
        closeButton
        toastOptions={{
          duration: 4500,
        }}
      />
      <AlertDialog
        open={state !== null}
        onOpenChange={(open) => {
          if (!open) finish(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title ?? 'Bestätigen'}</AlertDialogTitle>
            {state?.description && (
              <AlertDialogDescription className="whitespace-pre-line">
                {state.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(false)} autoFocus>
              {state?.cancelLabel ?? 'Abbrechen'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => finish(true)}
              className={
                state?.destructive === false
                  ? undefined
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              }
            >
              {state?.confirmLabel ?? (state?.destructive === false ? 'Bestätigen' : 'Löschen')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}
