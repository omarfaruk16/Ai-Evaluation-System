import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** True when the viewer asked the system for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const NUMBER = /-?\d[\d,]*(\.\d+)?/;
const parse = (text: string | null) => {
  const m = text ? NUMBER.exec(text) : null;
  return m ? { m, n: Number(m[0].replace(/,/g, '')), decimals: m[1] ? m[1].length - 1 : 0 } : null;
};

/**
 * Counts a formatted value ("৳1,234.50", "87%", "1.2K") up from zero when it first appears, and
 * from the old value to the new one when it changes. Only the first number in the text moves; its
 * prefix, suffix, separators and decimals are kept. Anything that isn't text is shown as is.
 */
export function AnimatedValue({ value, duration = 700 }: { value: ReactNode; duration?: number }) {
  const reduced = useReducedMotion();
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  const target = parse(text);
  const from = useRef(0);
  const [shown, setShown] = useState<number | null>(reduced || !target ? null : 0);

  useEffect(() => {
    const t = parse(text);
    if (reduced || !t) {
      setShown(null);
      return;
    }
    const start = from.current;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = start + (t.n - start) * (1 - (1 - p) ** 3); // ease-out cubic
      from.current = v;
      setShown(p < 1 ? v : null);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // A cancelled run (StrictMode, or a newer value) resumes from wherever it got to.
    return () => cancelAnimationFrame(raf);
  }, [reduced, text, duration]);

  if (!text || !target || shown === null) return <>{value}</>;
  const raw = target.m[0];
  const current = shown.toLocaleString('en-US', {
    minimumFractionDigits: target.decimals,
    maximumFractionDigits: target.decimals,
    useGrouping: raw.includes(','),
  });
  return <>{text.slice(0, target.m.index) + current + text.slice(target.m.index + raw.length)}</>;
}

/** A ring that fills to `value` (0–1) when it appears. The centre shows `children`. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 7,
  tone = 'accent',
  children,
  className,
  label,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  tone?: 'accent' | 'warning' | 'danger';
  children?: ReactNode;
  className?: string;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? (value ?? 0) : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value ?? 0);
      return;
    }
    const id = requestAnimationFrame(() => setShown(value ?? 0));
    return () => cancelAnimationFrame(id);
  }, [value, reduced]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, shown));
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent)';
  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? (value === null ? 'No data' : `${Math.round((value ?? 0) * 100)}%`)}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-soft)" strokeWidth={stroke} />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - clamped)}
            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        )}
      </svg>
      {children !== undefined && <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">{children}</div>}
    </div>
  );
}
