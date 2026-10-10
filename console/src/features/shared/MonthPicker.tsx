import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtMonth, shiftMonth } from '@/lib/format';

export function MonthPicker({ month, onChange, max }: { month: string; onChange: (m: string) => void; max?: string }) {
  return (
    <div className="bg-surface flex items-center gap-1 rounded-lg border p-0.5 shadow-card">
      <Button variant="ghost" size="icon" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        <ChevronLeft />
      </Button>
      <span className="min-w-[124px] text-center text-[13px] font-medium">{fmtMonth(month)}</span>
      <Button variant="ghost" size="icon" disabled={max !== undefined && month >= max} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        <ChevronRight />
      </Button>
    </div>
  );
}
