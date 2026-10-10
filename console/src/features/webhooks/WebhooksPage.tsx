import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Webhook as WebhookIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/controls';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, Pagination } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, fmtRelative } from '@/lib/format';
import type { Client, Paged, Webhook } from '@/lib/types';

type Status = 'all' | Webhook['status'];

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'all') as Status;
  const clientId = params.get('clientId') ?? '';
  const page = Number(params.get('page') ?? 1);
  const clients = useQuery({ queryKey: ['clients'], queryFn: ({ signal }) => get<Client[]>('/clients', signal) });
  const query = new URLSearchParams({ page: String(page), pageSize: '50', ...(status !== 'all' ? { status } : {}), ...(clientId ? { clientId } : {}) });
  const q = useQuery({
    queryKey: ['webhooks', query.toString()],
    queryFn: ({ signal }) => get<Paged<Webhook>>(`/webhooks?${query}`, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => post(`/webhooks/${id}/retry`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success('Delivery queued again');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Signed notifications sent to projects when results are ready. Failed deliveries retry with backoff; projects can also poll, so nothing is lost."
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={status}
          onChange={(v) => setParam('status', v)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'pending', label: 'Pending' },
            { value: 'failed', label: 'Failed' },
            { value: 'delivered', label: 'Delivered' },
          ]}
        />
        <Select className="w-52" value={clientId} onChange={(e) => setParam('clientId', e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {clients.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<WebhookIcon />} title="No deliveries match" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Created</Th>
                <Th>Project</Th>
                <Th>Event</Th>
                <Th>Status</Th>
                <Th className="text-right">Attempts</Th>
                <Th>Last response</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {q.data.items.map((w) => (
                <Tr key={w.id}>
                  <Td className="text-muted text-xs whitespace-nowrap" title={fmtDate(w.createdAt, true)}>
                    {fmtRelative(w.createdAt)}
                  </Td>
                  <Td>
                    <Link to={`/projects/${w.clientId}`} className="font-medium hover:underline">
                      {w.clientName}
                    </Link>
                    <p className="text-muted max-w-[260px] truncate font-mono text-[11px]" title={w.url}>
                      {w.url}
                    </p>
                  </Td>
                  <Td>
                    <Link to={`/evaluations?id=${w.evaluationId}`} className="font-mono text-xs hover:underline">
                      {w.event}
                    </Link>
                  </Td>
                  <Td>
                    <StatusBadge status={w.status} />
                  </Td>
                  <TdNum>{w.attempts}</TdNum>
                  <Td className="text-muted max-w-[220px] truncate text-xs" title={w.lastError ?? undefined}>
                    {w.lastError ?? (w.lastStatusCode ? `HTTP ${w.lastStatusCode}` : '—')}
                  </Td>
                  <Td className="text-right">
                    {w.status !== 'delivered' && (
                      <Button size="sm" variant="outline" onClick={() => retry.mutate(w.id)} loading={retry.isPending && retry.variables === w.id}>
                        <RotateCcw /> Retry
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} onPage={(p) => setParam('page', String(p))} />
        </Card>
      )}
    </>
  );
}
