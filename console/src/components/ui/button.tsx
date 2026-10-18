import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-[0_6px_16px_-6px_var(--primary)]',
  secondary: 'bg-primary-soft text-primary hover:bg-accent-soft',
  outline: 'border border-border bg-surface text-foreground hover:bg-surface-2 hover:border-input',
  ghost: 'text-foreground hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90 shadow-[0_6px_16px_-6px_var(--danger)]',
  'danger-outline': 'border border-border bg-surface text-danger hover:bg-danger-soft',
  link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
} as const;

const sizes = {
  // Fingers get bigger targets than mouse pointers.
  sm: 'h-8 rounded-lg px-3 text-[13px] gap-1.5 pointer-coarse:h-9',
  md: 'h-10 rounded-xl px-4 text-sm gap-2',
  lg: 'h-11 rounded-xl px-5 text-sm gap-2',
  icon: 'h-9 w-9 rounded-xl p-0 pointer-coarse:h-10 pointer-coarse:w-10',
} as const;

/** Button styling for a link (`<a>`) that should look like a button. */
export function buttonClass(variant: keyof typeof variants = 'primary', size: keyof typeof sizes = 'md', className?: string) {
  return cn(
    'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 select-none active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0',
    variants[variant],
    sizes[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-[color,background-color,border-color,transform,opacity] duration-150 select-none active:scale-[0.97] cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  );
});
