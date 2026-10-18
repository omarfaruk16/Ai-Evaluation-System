import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const overlay =
  'fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out';

const closeButton =
  'text-muted hover:bg-surface-2 hover:text-foreground -mt-1 -mr-2 rounded-md p-2 transition-colors sm:p-1.5';

/**
 * Modal dialog. On phones it is a bottom sheet (slides up, full width, buttons stretch to thumb
 * size); from `sm` up it is a centred card that pops in.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** false: a tap outside doesn't close it (for something that can't be shown again). */
  dismissible?: boolean;
}) {
  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          className={cn(
            'bg-surface fixed z-50 flex flex-col border shadow-2xl focus:outline-none',
            // Phone: bottom sheet
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down',
            // Tablet and up: centred card
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:rounded-2xl',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:data-[state=open]:animate-pop-in sm:data-[state=closed]:animate-pop-out',
            width,
          )}
        >
          <div className="bg-surface-3 mx-auto mt-2 h-1 w-10 shrink-0 rounded-full sm:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 border-b px-5 pt-3 pb-4 sm:pt-4">
            <div className="min-w-0">
              <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
              {description ? (
                <D.Description className="text-muted mt-1 text-[13px] leading-relaxed">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
              )}
            </div>
            <D.Close className={closeButton} aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && (
            <div className="bg-surface-2/50 pb-safe flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:flex-wrap sm:justify-end sm:rounded-b-2xl [&>*]:w-full sm:[&>*]:w-auto">
              {footer}
            </div>
          )}
          {!footer && <div className="pb-safe sm:hidden" />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Panel sliding in from the right, for detail views and long forms. Full screen on phones. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-2xl',
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** false: a click outside doesn't close it (forms with unsaved input). */
  dismissible?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          className={cn(
            'bg-surface pt-safe fixed inset-y-0 right-0 z-50 flex w-full flex-col shadow-2xl focus:outline-none sm:border-l',
            'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div className="min-w-0">
              <D.Title className="truncate text-base font-semibold tracking-tight">{title}</D.Title>
              {description ? (
                <D.Description className="text-muted mt-1 text-[13px]">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">Details</D.Description>
              )}
            </div>
            <D.Close className={closeButton} aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
          {footer && (
            <div className="bg-surface-2/50 pb-safe flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
              {footer}
            </div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
