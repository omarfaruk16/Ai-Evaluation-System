import { useQuery } from '@tanstack/react-query';
import { Download, Receipt } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { get } from '@/lib/api';
import { fmtDate, fmtMoney, fmtMonth } from '@/lib/format';
import type { Invoice, InvoiceStatus } from '@/lib/types';

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<InvoiceStatus | 'all'>('all');
  const q = useQuery({
    queryKey: ['billing', 'invoices', status],
    queryFn: ({ signal }) => get<Invoice[]>(`/billing/invoices${status === 'all' ? '' : `?status=${status}`}`, signal),
  });
  const outstanding = (q.data ?? []).filter((i) => i.status === 'issued');
  const overdue = outstanding.filter((i) => i.dueAt && new Date(i.dueAt) < new Date());

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Frozen monthly bills. Create them from Statements, issue them, then mark them paid."
        actions={
          <a href="/admin-api/billing/invoices.csv">
            <Button variant="outline">
              <Download /> CSV
            </Button>
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All' },
            { value: 'draft', label: 'Draft' },
            { value: 'issued', label: 'Issued' },
            { value: 'paid', label: 'Paid' },
            { value: 'void', label: 'Void' },
          ]}
        />
        {overdue.length > 0 && <p className="text-danger text-[13px] font-medium">{overdue.length} overdue</p>}
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState icon={<Receipt />} title="No invoices" description="Open Statements, pick a month and create an invoice for a client." />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Number</Th>
                <Th>Project</Th>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th>Due</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </THead>
            <tbody>
              {q.data.map((i) => {
                const late = i.status === 'issued' && i.dueAt && new Date(i.dueAt) < new Date();
                return (
                  <Tr key={i.id} onClick={() => navigate(`/billing/invoices/${i.id}`)}>
                    <Td className="font-medium">{i.number}</Td>
                    <Td>{i.clientName}</Td>
                    <Td>{fmtMonth(i.month)}</Td>
                    <Td>
                      <StatusBadge status={late ? 'failed' : i.status} label={late ? 'overdue' : undefined} />
                    </Td>
                    <Td className="text-muted">{i.dueAt ? fmtDate(i.dueAt) : '—'}</Td>
                    <TdNum className="font-medium">{fmtMoney(i.total, i.currency)}</TdNum>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
