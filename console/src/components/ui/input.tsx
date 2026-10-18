import { ChevronDown } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-xl border border-border bg-surface px-3.5 text-base sm:text-sm text-foreground placeholder:text-subtle transition-[border-color,box-shadow] duration-150 hover:border-input focus-visible:border-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & { prefix?: ReactNode; suffix?: ReactNode }>(
  function Input({ className, prefix, suffix, ...rest }, ref) {
    // Phones show a number pad with a decimal point for number fields.
    if (rest.type === 'number' && rest.inputMode === undefined) rest = { ...rest, inputMode: 'decimal' };
    if (!prefix && !suffix) return <input ref={ref} className={cn(field, 'h-11 sm:h-10', className)} {...rest} />;
    return (
      <div className={cn('relative flex items-center', className)}>
        {prefix && <span className="text-muted pointer-events-none absolute left-3.5 text-sm">{prefix}</span>}
        <input
          ref={ref}
          className={cn(field, 'h-11 sm:h-10', prefix ? 'pl-9' : '', suffix ? 'pr-14' : '')}
          {...rest}
        />
        {suffix && <span className="text-muted pointer-events-none absolute right-3 text-xs">{suffix}</span>}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(field, 'min-h-[84px] py-2 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(field, 'h-11 cursor-pointer appearance-none pr-9 sm:h-10')} {...rest}>
        {children}
      </select>
      <ChevronDown className="text-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
    </div>
  );
});

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('text-[13px] font-semibold text-foreground', className)}>
      {children}
    </label>
  );
}

/** Label + control + help/error text. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-danger text-xs">{error}</p> : hint ? <p className="text-muted text-xs leading-relaxed">{hint}</p> : null}
    </div>
  );
}
