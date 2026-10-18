import { useLayoutEffect, useRef, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Gives every body cell its column's header text, which a phone shows beside the value. */
function labelCells(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
  for (const tr of table.querySelectorAll('tbody tr')) {
    let col = 0;
    for (const cell of tr.children) {
      const td = cell as HTMLTableCellElement;
      const label = td.colSpan > 1 ? '' : (heads[col] ?? '');
      if (td.dataset.label !== label) td.dataset.label = label;
      col += td.colSpan || 1;
    }
  }
}

/**
 * A data table. On phones (`stack`, the default) each row turns into a card with labelled values;
 * pass `stack={false}` for grids that only make sense as a grid (they scroll sideways instead).
 */
export function Table({ className, stack = true, ...rest }: HTMLAttributes<HTMLTableElement> & { stack?: boolean }) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table || !stack) return;
    labelCells(table);
    // Rows can change without this component re-rendering (e.g. a row's own state).
    const mo = new MutationObserver(() => labelCells(table));
    mo.observe(table, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [stack]);
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table ref={ref} className={cn('w-full border-collapse text-left text-sm', stack && 'stack', className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-2 text-muted text-xs', className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-10 px-4 font-semibold whitespace-nowrap first:pl-5 last:pr-5', className)} {...rest} />;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-border/70 border-b transition-colors duration-150 last:border-0 hover:bg-primary-soft/40',
        rest.onClick && 'active:bg-primary-soft cursor-pointer',
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle first:pl-5 last:pr-5', className)} {...rest} />;
}

/** Right-aligned tabular number cell. */
export function TdNum({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <Td className={cn('tabular text-right whitespace-nowrap', className)} {...rest} />;
}
