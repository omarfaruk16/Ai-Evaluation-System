/** Offset of `timeZone` from UTC at `instant`, in ms (Asia/Dhaka → +6 h). */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (instant.getTime() - instant.getMilliseconds());
}

/** The UTC instant of local midnight on the given date in `timeZone`. */
export function zonedMidnight(year: number, month0: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month0, day);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  // Second pass handles a DST change between the guess and the answer.
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface Period {
  /** YYYY-MM */
  month: string;
  start: Date;
  end: Date;
}

/** A calendar month in the business time zone, as a [start, end) UTC range. */
export function monthPeriod(month: string, timeZone: string): Period {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}"`);
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) throw new Error(`Invalid month "${month}"`);
  return {
    month,
    start: zonedMidnight(year, month0, 1, timeZone),
    end: zonedMidnight(month0 === 11 ? year + 1 : year, (month0 + 1) % 12, 1, timeZone),
  };
}

/** The current month (YYYY-MM) in the business time zone. */
export function currentMonth(timeZone: string, now = new Date()): string {
  const local = new Date(now.getTime() + zoneOffsetMs(now, timeZone));
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
