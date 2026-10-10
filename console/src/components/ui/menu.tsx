import * as M from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={6}
          className="bg-surface z-50 min-w-[180px] rounded-lg border p-1 text-sm shadow-xl focus:outline-none"
        >
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'data-[highlighted]:bg-surface-2 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4',
        danger && 'text-danger',
      )}
    >
      {children}
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="bg-border -mx-1 my-1 h-px" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="text-muted px-2.5 py-1.5 text-xs">{children}</M.Label>
);
