import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-card',
  secondary: 'bg-surface-2 text-foreground hover:bg-surface-3',
  outline: 'border border-input bg-surface text-foreground hover:bg-surface-2 shadow-card',
  ghost: 'text-foreground hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90 shadow-card',
  'danger-outline': 'border border-input bg-surface text-danger hover:bg-danger-soft',
  link: 'text-primary underline-offset-4 hover:underline px-0 h-auto',
} as const;

const sizes = {
  // Fingers get bigger targets than mouse pointers.
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 pointer-coarse:h-9',
  md: 'h-9 px-3.5 text-sm gap-2 pointer-coarse:h-10',
  lg: 'h-10 px-4 text-sm gap-2 pointer-coarse:h-11',
  icon: 'h-8 w-8 p-0 pointer-coarse:h-10 pointer-coarse:w-10',
} as const;

/** Button styling for a link (`<a>`) that should look like a button. */
export function buttonClass(variant: keyof typeof variants = 'primary', size: keyof typeof sizes = 'md', className?: string) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 select-none active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0',
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
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-[color,background-color,border-color,transform,opacity] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
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
