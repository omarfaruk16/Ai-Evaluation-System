import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, Clock, Coins, Gauge, ListChecks, Receipt, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, Stat } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { get } from '@/lib/api';
import { costCurrencyCode, costCurrencySymbol, fmtCost, fmtInt, fmtMoney, fmtMonth, fmtMs, fmtNum, fmtPct, toCost, usdNote } from '@/lib/format';
import { CALL_KIND_LABEL, PROVIDER_LABEL, TASK_LABEL, type Overview, type Task } from '@/lib/types';
import { BarsChart, ChartFrame } from '../shared/charts';

const RANGES = ['7', '14', '30', '90'] as const;
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function OverviewPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]>('30');
  const q = useQuery({
    queryKey: ['overview', range],
    queryFn: ({ signal }) => get<Overview>(`/overview?days=${range}`, signal),
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Overview"
        description={q.data ? `Last ${q.data.days} days · dates in ${q.data.timeZone}` : 'How the marking service is doing'}
        actions={<Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: `${r} days` }))} size="sm" />}
      />
      {q.isPending ? <PageSkeleton /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Body o={q.data} />}
    </>
  );
}

function Body({ o }: { o: Overview }) {
  const t = o.totals;
  const aiMarked = Math.max(0, t.completed - t.blank - t.reused);
  const billing = Object.entries(o.month.totals);
  const realtime = o.turnaround.find((r) => r.lane === 'realtime');
  const queued = o.inFlight.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-6">
      <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5 [&>:last-child]:col-span-2 sm:[&>:last-child]:col-span-1">
        <Stat
          label="Answers marked"
          icon={<ListChecks />}
          value={fmtInt(t.completed)}
          sub={`${fmtInt(aiMarked)} by the model · ${fmtInt(t.reused)} reused · ${fmtInt(t.blank)} blank${t.failed ? ` · ${fmtInt(t.failed)} failed` : ''}`}
        />
        <Stat
          label="AI cost"
          icon={<Coins />}
          value={fmtCost(t.costUsd)}
          sub={
            <>
              {aiMarked > 0 ? `${fmtCost(t.costUsd / aiMarked)} per model-marked answer` : 'No model-marked answers yet'}
              {usdNote(t.costUsd) ? ` · ${usdNote(t.costUsd)}` : ''}
            </>
          }
        />
        <Stat
          label={`Billed in ${fmtMonth(o.month.month).split(' ')[0]}`}
          icon={<Receipt />}
          value={billing.length ? fmtMoney(billing[0]![1].subtotal, billing[0]![0], { compact: true }) : '—'}
          sub={
            billing.length ? (
              <>
                Margin {fmtMoney(billing[0]![1].margin, billing[0]![0], { compact: true })}
                {billing.length > 1 && ` · +${billing.length - 1} other currenc${billing.length > 2 ? 'ies' : 'y'}`}
              </>
            ) : (
              <Link to="/pricing" className="text-primary hover:underline">
                Assign a pricing plan to bill projects
              </Link>
            )
          }
        />
        <Stat
          label="Teacher agreement"
          icon={<Users />}
          value={fmtPct(o.agreement.acceptRate, 0)}
          tone={o.agreement.acceptRate === null ? undefined : o.agreement.acceptRate >= 0.8 ? 'success' : o.agreement.acceptRate >= 0.6 ? undefined : 'warning'}
          sub={
            o.agreement.reviewed
              ? `${fmtInt(o.agreement.reviewed)} reviewed · average change ${fmtNum(o.agreement.meanAbsDiff, 2)} marks`
              : 'No teacher reviews yet'
          }
        />
        <Stat
          label="Model response time"
          icon={<Gauge />}
          value={fmtMs(o.latency.p50Ms)}
          sub={`p95 ${fmtMs(o.latency.p95Ms)}${realtime ? ` · submit → suggestion p95 ${fmtMs(realtime.p95Ms)}` : ''}`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardBody>
            <ChartFrame title="Answers marked per day" value={`${fmtInt(t.completed)} total`}>
              <BarsChart data={o.daily} x="day" series={[{ key: 'completed', label: 'Answers', format: (v) => fmtInt(v) }]} xFormat={dayLabel} integer />
            </ChartFrame>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <ChartFrame title={`AI cost per day (${costCurrencyCode()})`} value={`${fmtCost(t.costUsd)} total`}>
              <BarsChart
                data={o.daily.map((d) => ({ ...d, cost: toCost(d.costUsd) }))}
                x="day"
                series={[{ key: 'cost', label: 'Cost', format: (v) => fmtCost(v / toCost(1)) }]}
                xFormat={dayLabel}
                yFormat={(v) => {
                  const sym = costCurrencySymbol();
                  return v === 0 ? `${sym}0` : v < 0.01 ? `${sym}${Number(v.toPrecision(2))}` : `${sym}${fmtNum(v, 2)}`;
                }}
              />
            </ChartFrame>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Models in use"
            description="Which profile serves each task. Change them under Models & providers."
            actions={
              <Link to="/models" className="text-primary text-[13px] font-medium hover:underline">
                Manage models
              </Link>
            }
          />
          <div className="divide-y">
            {(Object.keys(TASK_LABEL) as Task[]).map((task) => {
              const m = o.models[task];
              return (
                <div key={task} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-3">
                    <Bot className="text-muted size-4" />
                    <span className="text-sm font-medium">{TASK_LABEL[task]}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm">{m.name}</span>
                    <Badge tone={m.provider === 'mock' ? 'warning' : 'primary'}>{PROVIDER_LABEL[m.provider]}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Right now"
            actions={
              <Link to="/system" className="text-primary text-[13px] font-medium hover:underline">
                System
              </Link>
            }
          />
          <CardBody className="space-y-3 text-sm">
            <Row label="Answers waiting or being marked" value={fmtInt(queued)} />
            <Row label="Realtime queue (waiting / active)" value={`${fmtInt((o.queues.realtime.waiting ?? 0) + (o.queues.realtime.prioritized ?? 0))} / ${fmtInt(o.queues.realtime.active)}`} />
            <Row label="Deferred queue (waiting / active)" value={`${fmtInt((o.queues.deferred.waiting ?? 0) + (o.queues.deferred.prioritized ?? 0))} / ${fmtInt(o.queues.deferred.active)}`} />
            <Row
              label="Webhooks pending / failed"
              value={
                <span className={o.webhooks.failed ? 'text-danger' : ''}>
                  {fmtInt(o.webhooks.pending ?? 0)} / {fmtInt(o.webhooks.failed ?? 0)}
                </span>
              }
            />
            <Row label="Playground spend this month" value={fmtCost(o.month.consoleCostUsd)} />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Cost by task" description={`Project traffic and your own playground tests, in ${costCurrencyCode()}.`} />
          {o.byKind.length === 0 ? (
            <EmptyState icon={<Coins />} title="No model calls in this range" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Task</Th>
                  <Th>Source</Th>
                  <Th className="text-right">Calls</Th>
                  <Th className="text-right">Tokens in / out</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </THead>
              <tbody>
                {o.byKind
                  .slice()
                  .sort((a, b) => b.costUsd - a.costUsd)
                  .map((k) => (
                    <Tr key={`${k.kind}-${k.origin}`}>
                      <Td>{CALL_KIND_LABEL[k.kind]}</Td>
                      <Td>
                        <Badge tone={k.origin === 'console' ? 'neutral' : 'primary'}>{k.origin === 'console' ? 'Playground' : 'Projects'}</Badge>
                      </Td>
                      <TdNum>{fmtInt(k.calls)}</TdNum>
                      <TdNum className="text-muted">
                        {fmtInt(k.inputTokens)} / {fmtInt(k.outputTokens)}
                      </TdNum>
                      <TdNum className="font-medium">{fmtCost(k.costUsd)}</TdNum>
                    </Tr>
                  ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Models and hosts" description="Every model call in the range, grouped by the model and host that answered." />
          {o.byModel.length === 0 ? (
            <EmptyState icon={<Activity />} title="No model calls in this range" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Model · host</Th>
                  <Th className="text-right">Calls</Th>
                  <Th className="text-right">Failed</Th>
                  <Th className="text-right">Avg time</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </THead>
              <tbody>
                {o.byModel.map((m) => (
                  <Tr key={`${m.model}-${m.host}`}>
                    <Td className="max-w-[260px]">
                      <span className="block truncate font-mono text-[12.5px]">{m.model}</span>
                      <span className="text-muted text-xs">{m.host ?? 'unknown host'}</span>
                    </Td>
                    <TdNum>{fmtInt(m.calls)}</TdNum>
                    <TdNum className={m.failed ? 'text-danger' : 'text-muted'}>{fmtPct(m.calls ? m.failed / m.calls : 0, 1)}</TdNum>
                    <TdNum className="text-muted">{fmtMs(m.avgLatencyMs)}</TdNum>
                    <TdNum className="font-medium">{fmtCost(m.costUsd)}</TdNum>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Projects"
          description={`Answers marked and AI cost per project, last ${o.days} days.`}
          actions={
            <Link to="/projects" className="text-primary text-[13px] font-medium hover:underline">
              All projects
            </Link>
          }
        />
        {o.byClient.length === 0 ? (
          <EmptyState icon={<Users />} title="No projects yet" description="Create a project to give a customer’s software its API key." />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Project</Th>
                <Th className="text-right">Answers</Th>
                <Th className="text-right">AI cost</Th>
                <Th className="text-right">Cost per answer</Th>
              </tr>
            </THead>
            <tbody>
              {o.byClient.map((c) => (
                <Tr key={c.clientId}>
                  <Td>
                    <Link to={`/projects/${c.clientId}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <TdNum>{fmtInt(c.completed)}</TdNum>
                  <TdNum>{fmtCost(c.costUsd)}</TdNum>
                  <TdNum className="text-muted">{c.completed ? fmtCost(c.costUsd / c.completed) : '—'}</TdNum>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {t.estimatedCostShare > 0 && (
        <p className="text-muted flex items-center gap-2 text-xs">
          <Clock className="size-3.5" />
          {fmtPct(t.estimatedCostShare, 0)} of calls had no cost reported by the provider; their cost is estimated from the profile’s prices.
          <StatusBadge status="pending" label="estimated" />
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}
