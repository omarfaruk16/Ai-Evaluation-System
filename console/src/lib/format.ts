// Number, money, date and duration formatting. Money uses the currency's narrow symbol (৳, $).

const nf = new Intl.NumberFormat('en-US');

export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : nf.format(Math.round(n)));

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
}

export function fmtMoney(n: number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: opts.compact && Math.abs(n) >= 100_000 ? 'compact' : 'standard',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${fmtNum(n)}`;
  }
}

function symbolFor(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

/** AI costs are tiny: show enough significant digits (৳0.0926, ৳1.50, $0.000759). */
function fmtSmallMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const sym = symbolFor(currency);
  const abs = Math.abs(n);
  if (abs === 0) return `${sym}0.00`;
  if (abs >= 1) return `${sym}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (abs >= 0.01) return `${sym}${n.toFixed(4)}`;
  return `${sym}${n.toPrecision(3)}`;
}

/** An amount in US dollars, as dollars (provider prices, invoice records). */
export const fmtUsd = (n: number | null | undefined) => fmtSmallMoney(n, 'USD');

// AI costs are recorded in USD. The console shows them in the default billing currency
// (Settings → Currency) at its exchange rate; AppShell sets this once billing settings load.
let costCurrency = { code: 'USD', rate: 1 };

export function setCostCurrency(code: string | undefined, rate: number | undefined): void {
  costCurrency = code && rate && rate > 0 ? { code, rate } : { code: 'USD', rate: 1 };
}

export const costCurrencyCode = () => costCurrency.code;
export const costCurrencySymbol = () => symbolFor(costCurrency.code).trim();

/** A USD amount converted to the display currency (for charts). */
export const toCost = (usd: number) => usd * costCurrency.rate;

/** A USD cost shown in the display currency, e.g. $0.0012 → ৳0.146 at 122 BDT per USD. */
export const fmtCost = (usd: number | null | undefined) =>
  fmtSmallMoney(usd === null || usd === undefined ? usd : usd * costCurrency.rate, costCurrency.code);

/** The USD figure behind a converted cost, as a secondary label; null when already showing USD. */
export const usdNote = (usd: number | null | undefined) => (costCurrency.code === 'USD' ? null : fmtUsd(usd));

export const fmtPct = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(digits)}%`;

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return m < 60 ? `${m} min ${s ? `${s} s` : ''}`.trim() : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [86_400_000 * 365, 'y'],
    [86_400_000 * 30, 'mo'],
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'min'],
  ];
  for (const [size, label] of units) {
    if (abs >= size) {
      const v = Math.floor(abs / size);
      return diff >= 0 ? `${v} ${label} ago` : `in ${v} ${label}`;
    }
  }
  return 'just now';
}

/** "2026-10" → "October 2026" */
export function fmtMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export const fmtTokens = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : fmtInt(n);
