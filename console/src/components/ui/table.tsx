import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-2/60 text-muted text-xs', className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-9 border-b px-4 font-medium whitespace-nowrap first:pl-5 last:pr-5', className)} {...rest} />;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b last:border-0', rest.onClick && 'hover:bg-surface-2/60 cursor-pointer', className)} {...rest} />;
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5 align-middle first:pl-5 last:pr-5', className)} {...rest} />;
}

/** Right-aligned tabular number cell. */
export function TdNum({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <Td className={cn('tabular text-right whitespace-nowrap', className)} {...rest} />;
}
