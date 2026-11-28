import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface AdminPageProps {
  width?: 'default' | 'wide'
  className?: string
  children: ReactNode
}

export function AdminPage({
  width = 'default',
  className,
  children,
}: AdminPageProps) {
  return (
    <div
      className={cn(
        'w-full p-4 md:p-6 lg:p-8 max-w-full overflow-x-hidden',
        width === 'default' && 'mx-auto max-w-6xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface AdminPageHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function AdminPageHeader({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: AdminPageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-[-0.02em]">
          {icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-foreground shadow-xs">
              {icon}
            </span>
          )}
          <span>{title}</span>
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
