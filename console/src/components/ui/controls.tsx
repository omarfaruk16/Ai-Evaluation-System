import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { copyText } from '@/lib/clipboard';
import { maskSecret } from '@/lib/mask';
import { cn } from '@/lib/utils';

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const button = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-3 border-input border',
      )}
    >
      <span
        className={cn(
          'bg-surface inline-block size-4 rounded-full shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
  if (!label) return button;
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="pt-0.5">{button}</span>
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-muted text-xs leading-relaxed">{description}</span>}
      </span>
    </label>
  );
}

/** Pill-style choice between a few options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn('bg-surface-2 inline-flex rounded-lg border p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            value === o.value ? 'bg-surface text-foreground shadow-card' : 'text-muted hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({
  value,
  label = 'Copy',
  className,
  onFail,
}: {
  value: string;
  label?: string;
  className?: string;
  /** Called when the browser blocks copying; without it a toast explains what to do. */
  onFail?: () => void;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        if (await copyText(value, e.currentTarget.parentElement)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else if (onFail) {
          onFail();
        } else {
          toast.error('Copy failed — select the text and copy it by hand');
        }
      }}
      className={cn('text-muted hover:bg-surface-3 hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium', className)}
    >
      {done ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : label}
    </button>
  );
}

/**
 * A secret: only its first 4 characters are shown; Copy copies the full value. If the browser
 * blocks copying, the value is revealed already selected so it can be copied by hand (it may be
 * the only time it can be copied).
 */
export function SecretField({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const [manual, setManual] = useState(false);
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="bg-surface-2 flex items-center gap-2 rounded-md border px-3 py-2">
        {manual ? (
          <input
            readOnly
            value={value}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
            aria-label={label}
          />
        ) : (
          <code className="min-w-0 flex-1 truncate font-mono text-[13px] tracking-wide" aria-label={`${label}, hidden`}>
            {maskSecret(value)}
          </code>
        )}
        <CopyButton value={value} onFail={() => setManual(true)} />
      </div>
      {manual ? (
        <p className="text-warning text-xs leading-relaxed">This browser blocked copying. The value is selected above — press ⌘C (Ctrl+C on Windows).</p>
      ) : (
        hint && <p className="text-muted text-xs leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('border-muted/30 border-t-primary inline-block size-4 animate-spin rounded-full border-2', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-surface-3/70 animate-pulse rounded-md', className)} />;
}
