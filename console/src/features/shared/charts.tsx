import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';

// Recharts wrappers in the console style: thin marks, recessive grid and axes, one y-axis,
// series colours from --chart-N in fixed order, and a hover tooltip on every chart.

export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'] as const;

const axis = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const;

/** Marks grow in on first render, unless the viewer asked for less motion. */
const animate = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SeriesDef<T> {
  key: keyof T & string;
  label: string;
  format?: (v: number) => string;
}

function ChartTooltip<T>({
  active,
  payload,
  label,
  series,
  labelFormat,
}: TooltipProps<number, string> & { series: SeriesDef<T>[]; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface min-w-[160px] rounded-xl border px-3.5 py-2.5 text-xs shadow-xl">
      <p className="mb-1.5 font-semibold">{labelFormat ? labelFormat(String(label)) : label}</p>
      {payload.map((p, i) => {
        const def = series.find((s) => s.key === p.dataKey);
        return (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 py-0.5">
            <span className="text-muted flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
              {def?.label ?? p.name}
            </span>
            <span className="tabular font-medium">{def?.format ? def.format(Number(p.value)) : p.value}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Legend<T>({ series }: { series: SeriesDef<T>[] }) {
  if (series.length < 2) return null;
  return (
    <div className="text-muted flex flex-wrap gap-4 text-xs">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: SERIES[i] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Bars over a category axis; several series are grouped side by side. */
export function BarsChart<T extends object>({
  data,
  x,
  series,
  height = 220,
  xFormat,
  yFormat,
  labelFormat,
  integer = false,
}: {
  data: T[];
  x: keyof T & string;
  series: SeriesDef<T>[];
  height?: number;
  xFormat?: (v: string) => string;
  yFormat?: (v: number) => string;
  labelFormat?: (l: string) => string;
  /** Whole-number ticks, for counts. */
  integer?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={x} {...axis} tickFormatter={xFormat} minTickGap={16} />
          <YAxis {...axis} width={60} tickFormatter={yFormat} allowDecimals={!integer} />
          <Tooltip
            cursor={{ fill: 'var(--primary-soft)', radius: 8 } as object}
            content={<ChartTooltip series={series} labelFormat={labelFormat ?? xFormat} />}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={SERIES[i]}
              radius={[6, 6, 2, 2]}
              maxBarSize={26}
              isAnimationActive={animate()}
              animationDuration={700}
              animationEasing="ease-out"
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinesChart<T extends object>({
  data,
  x,
  series,
  height = 220,
  xFormat,
  yFormat,
  labelFormat,
  xType = 'category',
}: {
  data: T[];
  x: keyof T & string;
  series: SeriesDef<T>[];
  height?: number;
  xFormat?: (v: string | number) => string;
  yFormat?: (v: number) => string;
  labelFormat?: (l: string) => string;
  xType?: 'category' | 'number';
}) {
  return (
    <div className="space-y-3">
      <Legend series={series} />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey={x} {...axis} type={xType} domain={xType === 'number' ? ['dataMin', 'dataMax'] : undefined} tickFormatter={xFormat} minTickGap={24} />
          <YAxis {...axis} width={64} tickFormatter={yFormat} />
          <Tooltip
            cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
            content={<ChartTooltip series={series} labelFormat={labelFormat} />}
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              dataKey={s.key}
              stroke={SERIES[i]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              isAnimationActive={animate()}
              animationDuration={800}
              animationEasing="ease-out"
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartFrame({ title, value, children }: { title: ReactNode; value?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        {value && <p className="tabular bg-primary-soft text-primary rounded-full px-2.5 py-0.5 text-xs font-semibold">{value}</p>}
      </div>
      {children}
    </div>
  );
}
