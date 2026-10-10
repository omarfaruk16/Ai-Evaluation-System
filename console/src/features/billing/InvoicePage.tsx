import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, Printer, Send, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Textarea } from '@/components/ui/input';
import { DefinitionList, ErrorState, PageSkeleton } from '@/components/ui/page';
import { del, errorMessage, get, patch } from '@/lib/api';
import { fmtDate, fmtInt, fmtMoney, fmtMonth, fmtUsd } from '@/lib/format';
import type { Invoice, InvoiceStatus } from '@/lib/types';

export default function InvoicePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['billing', 'invoice', id], queryFn: ({ signal }) => get<Invoice>(`/billing/invoices/${id}`, signal) });
  const [notes, setNotes] = useState('');
  useEffect(() => setNotes(q.data?.notes ?? ''), [q.data?.notes]);

  const update = useMutation({
    mutationFn: (body: { status?: InvoiceStatus; notes?: string | null }) => patch<Invoice>(`/billing/invoices/${id}`, body),
    onSuccess: (inv) => {
      qc.setQueryData(['billing', 'invoice', id], inv);
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success('Invoice updated');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => del(`/billing/invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success('Draft deleted');
      navigate('/billing/invoices');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const inv = q.data;
  const { to, from } = inv.parties;
  const m = (v: number) => fmtMoney(v, inv.currency);
  const fxCost = inv.costUsd * (inv.fxUsdRate ?? 1);

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/billing/invoices" className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-[13px]">
            <ArrowLeft className="size-3.5" /> Invoices
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight">{inv.number}</h1>
            <StatusBadge status={inv.status} />
          </div>
          <p className="text-muted mt-1 text-sm">
            {inv.clientName} · {fmtMonth(inv.month)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print / PDF
          </Button>
          {inv.status === 'draft' && (
            <>
              <Button
                variant="danger-outline"
                onClick={async () => {
                  if (await confirm({ title: `Delete draft ${inv.number}?`, confirmLabel: 'Delete', danger: true })) remove.mutate();
                }}
              >
                <Trash2 /> Delete
              </Button>
              <Button
                onClick={async () => {
                  if (await confirm({ title: 'Issue this invoice?', description: 'It gets an issue date and due date. After that it can only be paid or voided.', confirmLabel: 'Issue' }))
                    update.mutate({ status: 'issued' });
                }}
                loading={update.isPending}
              >
                <Send /> Issue
              </Button>
            </>
          )}
          {inv.status === 'issued' && (
            <>
              <Button
                variant="danger-outline"
                onClick={async () => {
                  if (await confirm({ title: 'Void this invoice?', description: 'A void invoice is kept for the record. You can then create a new one for the month.', confirmLabel: 'Void', danger: true }))
                    update.mutate({ status: 'void' });
                }}
              >
                <Ban /> Void
              </Button>
              <Button onClick={() => update.mutate({ status: 'paid' })} loading={update.isPending}>
                <CheckCircle2 /> Mark paid
              </Button>
            </>
          )}
          {inv.status === 'paid' && (
            <Button variant="outline" onClick={() => update.mutate({ status: 'issued' })} loading={update.isPending}>
              <Undo2 /> Mark unpaid
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="print-sheet bg-white text-zinc-900 mx-auto w-full max-w-[820px] rounded-xl border p-8 shadow-card sm:p-12">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xl font-semibold tracking-tight">{from.name || 'Your business name'}</p>
              {from.address && <p className="mt-1 text-[13px] whitespace-pre-line text-zinc-600">{from.address}</p>}
              <p className="mt-1 text-[13px] text-zinc-600">{[from.email, from.phone].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tracking-tight text-zinc-400 uppercase">Invoice</p>
              <p className="mt-1 text-sm font-medium">{inv.number}</p>
              {inv.status === 'void' && <p className="mt-1 text-sm font-semibold text-red-600 uppercase">Void</p>}
              {inv.status === 'paid' && <p className="mt-1 text-sm font-semibold text-green-700 uppercase">Paid {fmtDate(inv.paidAt)}</p>}
            </div>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Bill to</p>
              <p className="mt-1.5 text-sm font-medium">{to.organisation}</p>
              {to.name && to.name !== to.organisation && <p className="text-[13px]">{to.name}</p>}
              {to.address && <p className="text-[13px] whitespace-pre-line text-zinc-600">{to.address}</p>}
              {to.email && <p className="text-[13px] text-zinc-600">{to.email}</p>}
            </div>
            <div className="text-[13px] sm:text-right">
              <p>
                <span className="text-zinc-500">Billing period </span>
                {fmtMonth(inv.month)}
              </p>
              <p>
                <span className="text-zinc-500">Issue date </span>
                {inv.issuedAt ? fmtDate(inv.issuedAt) : 'Not issued'}
              </p>
              <p>
                <span className="text-zinc-500">Due date </span>
                {inv.dueAt ? fmtDate(inv.dueAt) : '—'}
              </p>
              <p>
                <span className="text-zinc-500">Plan </span>
                {inv.parties.plan}
              </p>
            </div>
          </div>

          <table className="mt-10 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-xs text-zinc-500">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Unit price</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-zinc-200">
                  <td className="py-3 pr-4">{l.description}</td>
                  <td className="tabular py-3 text-right">{fmtInt(l.quantity)}</td>
                  <td className="tabular py-3 text-right">{l.unitPrice === 0 ? '—' : m(l.unitPrice)}</td>
                  <td className="tabular py-3 text-right">{m(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Subtotal</span>
              <span className="tabular">{m(inv.subtotal)}</span>
            </div>
            {inv.taxPercent > 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Tax ({inv.taxPercent}%)</span>
                <span className="tabular">{m(inv.tax)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-zinc-300 pt-2 text-base font-semibold">
              <span>Total due</span>
              <span className="tabular">{m(inv.total)}</span>
            </div>
          </div>

          <div className="mt-8 text-[13px] text-zinc-600">
            Usage this period: {fmtInt(inv.parties.usage.completed)} answers marked ({fmtInt(inv.parties.usage.blank)} blank, {fmtInt(inv.parties.usage.reused)} reused),{' '}
            {fmtInt(inv.parties.usage.rubricDrafts)} rubric drafts.
          </div>
          {from.paymentDetails && (
            <div className="mt-8">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">How to pay</p>
              <p className="mt-1.5 text-[13px] whitespace-pre-line">{from.paymentDetails}</p>
            </div>
          )}
          {inv.notes && <p className="mt-6 text-[13px] whitespace-pre-line">{inv.notes}</p>}
          {from.footer && <p className="mt-10 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-500">{from.footer}</p>}
        </div>

        <div className="no-print space-y-4">
          <Card>
            <CardHeader title="Internal" description="Not shown on the invoice." />
            <CardBody>
              <DefinitionList
                className="text-[13px]"
                items={[
                  ['AI cost', `${fmtUsd(inv.costUsd)}${inv.fxUsdRate && inv.currency !== 'USD' ? ` · ${m(fxCost)}` : ''}`],
                  ['Margin', <span className={inv.subtotal - fxCost < 0 ? 'text-danger' : 'text-success'}>{m(inv.subtotal - fxCost)}</span>],
                  ['Exchange rate', inv.fxUsdRate ? `1 USD = ${inv.fxUsdRate} ${inv.currency}` : '—'],
                  ['Created', fmtDate(inv.createdAt, true)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Note on the invoice" />
            <CardBody className="space-y-3">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Purchase order number" disabled={inv.status === 'void'} />
              <Button size="sm" variant="outline" disabled={notes === (inv.notes ?? '')} onClick={() => update.mutate({ notes: notes.trim() || null })}>
                Save note
              </Button>
            </CardBody>
          </Card>
          {!from.name && (
            <p className="bg-warning-soft text-warning rounded-lg px-4 py-3 text-[13px]">
              Your business name and payment details are empty. Fill them in under{' '}
              <Link to="/settings" className="underline">
                Settings
              </Link>{' '}
              before creating invoices — existing invoices keep the details they were made with.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
