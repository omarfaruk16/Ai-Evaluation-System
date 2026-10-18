import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-surface-3 text-muted border-transparent',
  primary: 'bg-primary-soft text-primary border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  completed: 'success',
  delivered: 'success',
  paid: 'success',
  accepted: 'success',
  active: 'success',
  running: 'info',
  issued: 'info',
  queued: 'neutral',
  pending: 'neutral',
  draft: 'neutral',
  adjusted: 'warning',
  failed: 'danger',
  rejected: 'danger',
  void: 'neutral',
  disabled: 'neutral',
};

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
      {sentence(label ?? status.replace(/_/g, ' '))}
    </Badge>
  );
}
