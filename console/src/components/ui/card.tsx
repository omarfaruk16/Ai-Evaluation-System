import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A soft white panel. `interactive` lifts it slightly on hover (for cards that open something). */
export function Card({ className, interactive, ...rest }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'bg-surface shadow-card rounded-2xl border border-transparent dark:border-border',
        interactive && 'hover:shadow-lift transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2 sm:px-5 sm:pt-5', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]">{icon}</span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-muted mt-0.5 text-[13px] leading-relaxed">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 py-4 sm:px-5', className)} {...rest} />;
}
