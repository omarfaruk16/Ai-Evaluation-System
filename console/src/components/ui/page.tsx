import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Skeleton } from './controls';

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted mt-1 max-w-3xl text-sm leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
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
      <div className="bg-surface-2 text-muted mb-3 flex size-10 items-center justify-center rounded-full [&_svg]:size-5">{icon ?? <Inbox />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-muted mt-1 max-w-sm text-[13px] leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="border-danger/30 bg-danger-soft flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4">
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

/** KPI tile. */
export function Stat({
  label,
  value,
  sub,
  icon,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'success' | 'warning' | 'danger';
  className?: string;
}) {
  return (
    <div className={cn('bg-surface rounded-xl border px-5 py-4 shadow-card', className)}>
      <div className="text-muted flex items-center justify-between gap-2 text-[13px] font-medium">
        <span>{label}</span>
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
      </div>
      <div
        className={cn(
          'tabular mt-2 text-2xl font-semibold tracking-tight',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-muted mt-1 text-xs leading-relaxed">{sub}</div>}
    </div>
  );
}

/** Label/value rows for detail panels. */
export function DefinitionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(110px,auto)_1fr] gap-x-6 gap-y-2.5 text-sm', className)}>
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
    <div className="text-muted flex items-center justify-between gap-3 border-t px-5 py-3 text-[13px]">
      <span className="tabular">
        {total.toLocaleString('en-US')} result{total === 1 ? '' : 's'} · page {page} of {pages}
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
