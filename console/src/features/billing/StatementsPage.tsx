import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FilePlus2, Info } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, Stat } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { errorMessage, get, post } from '@/lib/api';
import { costCurrencyCode, fmtCost, fmtInt, fmtMoney, fmtMonth, usdNote } from '@/lib/format';
import type { Invoice, Statements } from '@/lib/types';
import { MonthPicker } from '../shared/MonthPicker';

export default function StatementsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [month, setMonth] = useState<string | undefined>(params.get('month') ?? undefined);
  const q = useQuery({
    queryKey: ['billing', 'statements', month ?? 'current'],
    queryFn: ({ signal }) => get<Statements>(`/billing/statements${month ? `?month=${month}` : ''}`, signal),
  });
  const current = useQuery({ queryKey: ['billing', 'statements', 'current'], queryFn: ({ signal }) => get<Statements>('/billing/statements', signal), enabled: month !== undefined });
  const maxMonth = month === undefined ? q.data?.month : current.data?.month;

  const create = useMutation({
    mutationFn: (clientId: string) => post<Invoice>('/billing/invoices', { clientId, month: q.data!.month }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success(`Invoice ${inv.number} created as a draft`);
      navigate(`/billing/invoices/${inv.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const changeMonth = (m: string) => {
    setMonth(m);
    setParams({ month: m }, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Statements"
        description="What each project owes for a month under its plan, what it cost you, and your margin. Answers count in the month they were marked."
        actions={
          q.data && (
            <>
              <MonthPicker month={q.data.month} onChange={changeMonth} max={maxMonth} />
              <a href={`/admin-api/billing/statements.csv?month=${q.data.month}`} className={buttonClass('outline')} download>
                <Download /> CSV
              </a>
            </>
          )
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {Object.keys(q.data.totals).length === 0 ? (
              <Stat label="Billed" value="—" sub="No project has a pricing plan" />
            ) : (
              Object.entries(q.data.totals).map(([cur, t]) => (
                <Stat key={cur} label={`Billed (${cur}, before tax)`} value={fmtMoney(t.subtotal, cur)} sub={`${fmtMoney(t.total, cur)} with tax · margin ${fmtMoney(t.margin, cur)}`} />
              ))
            )}
            <Stat label="AI cost from projects" value={fmtCost(q.data.costUsd)} sub={usdNote(q.data.costUsd) ?? undefined} />
            <Stat label="Playground spend" value={fmtCost(q.data.consoleCostUsd)} sub="Your own tests — not billed" />
          </div>

          <Card>
            <CardHeader title={fmtMonth(q.data.month)} description={`Period in ${q.data.timeZone}. Figures stay live until you create the invoice, which freezes them.`} />
            {q.data.rows.length === 0 ? (
              <EmptyState title="No projects" description="Create a project and assign it a pricing plan." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Project</Th>
                    <Th className="text-right">Answers</Th>
                    <Th className="text-right">Billable</Th>
                    <Th className="text-right">Drafts</Th>
                    <Th className="text-right">Subtotal</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">AI cost</Th>
                    <Th className="text-right">Margin</Th>
                    <Th>Invoice</Th>
                  </tr>
                </THead>
                <tbody>
                  {q.data.rows.map((r) => {
                    const cur = r.plan?.currency ?? 'USD';
                    return (
                      <Tr key={r.client.id}>
                        <Td>
                          <Link to={`/projects/${r.client.id}`} className="font-medium hover:underline">
                            {r.client.name}
                          </Link>
                          <p className="text-muted text-xs">{r.plan ? r.plan.name : 'No plan — not billed'}</p>
                        </Td>
                        <TdNum>
                          {fmtInt(r.usage.completed)}
                          {r.usage.failed > 0 && <span className="text-danger block text-xs">{fmtInt(r.usage.failed)} failed</span>}
                        </TdNum>
                        <TdNum>{r.charges ? fmtInt(r.charges.billableAnswers) : '—'}</TdNum>
                        <TdNum>{fmtInt(r.usage.rubricDrafts)}</TdNum>
                        <TdNum>{r.charges ? fmtMoney(r.charges.subtotal, cur) : '—'}</TdNum>
                        <TdNum className="font-medium">{r.charges ? fmtMoney(r.charges.total, cur) : '—'}</TdNum>
                        <TdNum>
                          {fmtCost(r.usage.costUsd)}
                          {r.charges && cur !== costCurrencyCode() && <span className="text-muted block text-xs">{fmtMoney(r.charges.cost, cur)}</span>}
                          {usdNote(r.usage.costUsd) && <span className="text-muted block text-xs">{usdNote(r.usage.costUsd)}</span>}
                        </TdNum>
                        <TdNum className={r.charges && r.charges.margin < 0 ? 'text-danger' : ''}>
                          {r.charges ? fmtMoney(r.charges.margin, cur) : '—'}
                          {r.charges?.marginPercent !== null && r.charges && <span className="text-muted block text-xs">{r.charges.marginPercent}%</span>}
                        </TdNum>
                        <Td>
                          {r.invoice ? (
                            <Link to={`/billing/invoices/${r.invoice.id}`} className="inline-flex items-center gap-2 hover:underline">
                              <span className="text-[13px] font-medium">{r.invoice.number}</span>
                              <StatusBadge status={r.invoice.status} />
                            </Link>
                          ) : r.plan ? (
                            <Button size="sm" variant="outline" loading={create.isPending && create.variables === r.client.id} onClick={() => create.mutate(r.client.id)}>
                              <FilePlus2 /> Create
                            </Button>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <p className="text-muted flex items-start gap-2 text-xs leading-relaxed">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            AI cost includes failed calls and retries. Costs in other currencies use the exchange rates under Settings; an invoice keeps the rate it was made with.
          </p>
        </div>
      )}
    </>
  );
}
