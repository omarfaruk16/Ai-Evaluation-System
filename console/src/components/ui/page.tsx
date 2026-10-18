import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './controls';
import { AnimatedValue, ProgressRing } from './motion';

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7 sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight text-balance sm:text-[26px]">{title}</h1>
        {description && <p className="text-muted mt-1.5 max-w-3xl text-[13px] leading-relaxed sm:text-sm">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="bg-primary-soft text-primary mb-3 flex size-12 items-center justify-center rounded-2xl [&_svg]:size-5">{icon ?? <Inbox />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-muted mt-1 max-w-sm text-[13px] leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="border-danger/30 bg-danger-soft animate-fade-up flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="text-danger mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-medium">Couldn’t load this</p>
          <p className="text-muted text-[13px]">{errorMessage(error)}</p>
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl sm:h-32" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

/**
 * KPI tile: an icon chip, the label, a value that counts up when it appears, and optionally a
 * ring (0–1) on the right, for values that are a share of something (agreement, budget used).
 */
export function Stat({
  label,
  value,
  sub,
  icon,
  tone,
  ring,
  ringLabel,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'success' | 'warning' | 'danger';
  ring?: number | null;
  ringLabel?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-surface shadow-card hover:shadow-lift min-w-0 rounded-2xl border border-transparent px-4 py-4 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 sm:px-5 dark:border-border',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]">{icon}</span>
        )}
        <span className="text-muted min-w-0 text-[13px] leading-snug font-medium">{label}</span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div
          className={cn(
            'tabular min-w-0 truncate text-[22px] font-bold tracking-tight sm:text-[26px]',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'danger' && 'text-danger',
          )}
        >
          <AnimatedValue value={value} />
        </div>
        {ring !== undefined && (
          <ProgressRing value={ring} size={44} stroke={5} tone={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'accent'}>
            {ringLabel !== undefined && <span className="text-[10px] font-semibold">{ringLabel}</span>}
          </ProgressRing>
        )}
      </div>
      {sub && <div className="text-muted mt-1.5 text-xs leading-relaxed">{sub}</div>}
    </div>
  );
}

/** Label/value rows for detail panels. */
export function DefinitionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-2.5 text-sm sm:gap-x-6', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="text-muted flex items-center justify-between gap-3 border-t px-4 py-3 text-[13px] sm:px-5">
      <span className="tabular">
        {total.toLocaleString('en-US')}
        <span className="hidden sm:inline"> result{total === 1 ? '' : 's'}</span> · {page}/{pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
