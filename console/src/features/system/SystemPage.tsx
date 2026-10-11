import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Segmented } from '@/components/ui/controls';
import { DefinitionList, EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { del, errorMessage, get, post } from '@/lib/api';
import { fmtInt, fmtRelative } from '@/lib/format';
import type { FailedJob, QueueStatus, SystemStatus } from '@/lib/types';

const QUEUE_LABEL: Record<QueueStatus['key'], string> = { realtime: 'Realtime marking', deferred: 'Deferred marking', webhooks: 'Webhooks' };

function uptime(sec: number) {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

export default function SystemPage() {
  const q = useQuery({ queryKey: ['system'], queryFn: ({ signal }) => get<SystemStatus>('/system', signal), refetchInterval: 5_000 });
  const [failedQueue, setFailedQueue] = useState<QueueStatus['key']>('realtime');
  return (
    <>
      <PageHeader title="System" description="Queues, workers and the configuration this server is running with. Refreshes every 5 seconds." />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            {q.data.queues.map((qs) => (
              <QueueCard key={qs.key} q={qs} />
            ))}
          </div>
          <Card>
            <CardHeader
              title="Failed jobs"
              description="Jobs that used all their attempts. Evaluations behind them are already marked failed and the project was told."
              actions={
                <Segmented
                  size="sm"
                  value={failedQueue}
                  onChange={setFailedQueue}
                  options={q.data.queues.map((x) => ({ value: x.key, label: `${QUEUE_LABEL[x.key]} (${fmtInt(x.counts.failed ?? 0)})` }))}
                />
              }
            />
            <FailedJobs queue={failedQueue} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Server" />
              <CardBody>
                <DefinitionList
                  className="text-[13px]"
                  items={[
                    ['Version', q.data.version],
                    ['Node.js', q.data.node],
                    ['Uptime', uptime(q.data.uptimeSec)],
                    ['Database', <StatusBadge status={q.data.db === 'ok' ? 'completed' : 'failed'} label={q.data.db} />],
                    ['Prompt versions', Object.entries(q.data.promptVersions).map(([k, v]) => `${k}: ${v}`).join(' · ')],
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Configuration" description="From the server environment. Change in .env and restart." />
              <CardBody>
                <pre className="bg-surface-2 max-h-72 overflow-auto rounded-md p-3 font-mono text-[11.5px] leading-relaxed">{JSON.stringify(q.data.config, null, 2)}</pre>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function QueueCard({ q }: { q: QueueStatus }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const toggle = useMutation({
    mutationFn: () => post(`/system/queues/${q.key}/${q.paused ? 'resume' : 'pause'}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system'] });
      toast.success(q.paused ? 'Queue resumed' : 'Queue paused');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const c = q.counts;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div>
          <h3 className="text-[15px] font-semibold">{QUEUE_LABEL[q.key]}</h3>
          <p className="text-muted text-xs">
            {q.workers === null ? 'workers unknown' : `${q.workers} worker${q.workers === 1 ? '' : 's'} connected`}
          </p>
        </div>
        {q.paused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success" dot>Running</Badge>}
      </div>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          {(
            [
              ['Waiting', (c.waiting ?? 0) + (c.prioritized ?? 0)],
              ['Active', c.active ?? 0],
              ['Delayed', c.delayed ?? 0],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="bg-surface-2/70 rounded-lg py-2">
              <p className="tabular text-lg font-semibold">{fmtInt(v)}</p>
              <p className="text-muted text-[11px]">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span className="text-muted">
            {fmtInt(c.completed ?? 0)} completed (recent) · <span className={c.failed ? 'text-danger' : ''}>{fmtInt(c.failed ?? 0)} failed</span>
          </span>
          <Button
            size="sm"
            variant={q.paused ? 'primary' : 'outline'}
            loading={toggle.isPending}
            onClick={async () => {
              if (
                q.paused ||
                (await confirm({
                  title: `Pause ${QUEUE_LABEL[q.key].toLowerCase()}?`,
                  description: 'Workers on every server stop taking new jobs; running ones finish. Projects keep submitting and wait.',
                  confirmLabel: 'Pause',
                  danger: true,
                }))
              )
                toggle.mutate();
            }}
          >
            {q.paused ? <Play /> : <Pause />} {q.paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function FailedJobs({ queue }: { queue: QueueStatus['key'] }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system', 'failed', queue], queryFn: ({ signal }) => get<FailedJob[]>(`/system/queues/${queue}/failed`, signal) });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'retry' | 'remove' }) =>
      action === 'retry' ? post(`/system/queues/${queue}/failed/${id}/retry`) : del(`/system/queues/${queue}/failed/${id}`),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['system'] });
      toast.success(v.action === 'retry' ? 'Job retried' : 'Job removed');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <div className="text-muted px-5 py-6 text-sm">Loading…</div>;
  if (q.isError) return <div className="p-5"><ErrorState error={q.error} /></div>;
  if (q.data.length === 0) return <EmptyState title="No failed jobs" description="Everything in this queue finished or is still running." />;
  return (
    <Table>
      <THead>
        <tr>
          <Th>Job</Th>
          <Th>Reason</Th>
          <Th className="text-right">Attempts</Th>
          <Th>Failed</Th>
          <Th />
        </tr>
      </THead>
      <tbody>
        {q.data.map((j) => (
          <Tr key={j.id}>
            <Td className="font-mono text-xs">{j.id}</Td>
            <Td className="text-muted max-w-[380px] truncate text-xs" title={j.failedReason} data-block>
              {j.failedReason}
            </Td>
            <TdNum>{j.attemptsMade}</TdNum>
            <Td className="text-muted text-xs">{fmtRelative(j.finishedOn)}</Td>
            <Td className="text-right whitespace-nowrap">
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: j.id, action: 'retry' })}>
                <RotateCcw /> Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: j.id, action: 'remove' })} aria-label="Remove">
                <Trash2 />
              </Button>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
