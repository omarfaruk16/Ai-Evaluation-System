import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Inbox, Mail, Phone, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Segmented } from '@/components/ui/controls';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { DefinitionList, EmptyState, ErrorState, PageHeader, PageSkeleton, Pagination } from '@/components/ui/page';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { del, errorMessage, get, patch } from '@/lib/api';
import { fmtDate, fmtRelative } from '@/lib/format';
import type { Lead, LeadKind, LeadList, LeadStatus } from '@/lib/types';

const KIND: Record<LeadKind, { label: string; tone: Tone }> = {
  pilot: { label: 'Free pilot', tone: 'primary' },
  demo: { label: 'Demo', tone: 'info' },
  partner: { label: 'Partner / sponsor', tone: 'warning' },
  contact: { label: 'Message', tone: 'neutral' },
};

const STATUS: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'primary' },
  contacted: { label: 'Contacted', tone: 'info' },
  qualified: { label: 'Qualified', tone: 'warning' },
  won: { label: 'Won', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
  spam: { label: 'Spam', tone: 'danger' },
};
const STATUSES = Object.keys(STATUS) as LeadStatus[];

export default function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const kind = params.get('kind') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(q);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = new URLSearchParams({
    page: String(page),
    pageSize: '50',
    ...(status !== 'all' ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
  });
  const list = useQuery({
    queryKey: ['leads', query.toString()],
    queryFn: ({ signal }) => get<LeadList>(`/leads?${query}`, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'all') next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => search !== q && setParam('q', search.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = list.data?.counts;
  const open = list.data?.items.find((l) => l.id === openId) ?? null;
  const exportQuery = new URLSearchParams(query);
  exportQuery.delete('page');
  exportQuery.delete('pageSize');

  return (
    <>
      <PageHeader
        title="Leads"
        description="Free-pilot, demo, partnership and contact requests sent from scholametrix.tech. Follow up, then move each one along."
        actions={
          <a href={`/admin-api/leads/export.csv?${exportQuery}`} className={buttonClass('outline')}>
            <Download /> Export CSV
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={status}
          onChange={(v) => setParam('status', v)}
          options={[
            { value: 'all', label: 'Open' },
            ...STATUSES.map((s) => ({
              value: s,
              label: counts && counts[s] > 0 && s !== 'spam' ? `${STATUS[s].label} · ${counts[s]}` : STATUS[s].label,
            })),
          ]}
        />
        <Select className="w-full sm:w-48" value={kind} onChange={(e) => setParam('kind', e.target.value)} aria-label="Request type">
          <option value="">All requests</option>
          {(Object.keys(KIND) as LeadKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND[k].label}
            </option>
          ))}
        </Select>
        <Input
          className="w-full sm:w-64"
          prefix={<Search />}
          placeholder="Name, email, institution…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search leads"
        />
      </div>

      {list.isPending ? (
        <PageSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox />}
            title={q || kind || status !== 'all' ? 'No requests match' : 'No requests yet'}
            description="When someone sends a form on the website, it appears here."
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Received</Th>
                <Th>From</Th>
                <Th>Institution</Th>
                <Th>Request</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <tbody>
              {list.data.items.map((l) => (
                <Tr key={l.id} className="cursor-pointer" onClick={() => setOpenId(l.id)}>
                  <Td className="text-muted text-xs whitespace-nowrap" title={fmtDate(l.createdAt, true)}>
                    {fmtRelative(l.createdAt)}
                  </Td>
                  <Td data-title>
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpenId(l.id)}>
                      {l.name}
                    </button>
                    <p className="text-muted text-xs">{l.email}</p>
                  </Td>
                  <Td className="max-w-[240px]">
                    <p className="truncate">{l.institution ?? '—'}</p>
                    {l.country && <p className="text-muted text-xs">{l.country}</p>}
                  </Td>
                  <Td>
                    <Badge tone={KIND[l.kind].tone}>{KIND[l.kind].label}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={STATUS[l.status].tone} dot>
                      {STATUS[l.status].label}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={(p) => setParam('page', String(p))} />
        </Card>
      )}

      <LeadSheet lead={open} onClose={() => setOpenId(null)} />
    </>
  );
}

function LeadSheet({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [note, setNote] = useState('');
  useEffect(() => setNote(lead?.note ?? ''), [lead?.id, lead?.note]);

  const save = useMutation({
    mutationFn: (body: { status?: LeadStatus; note?: string | null }) => patch<Lead>(`/leads/${lead!.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => del(`/leads/${lead!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      toast.success('Request deleted');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const whatsapp = lead?.phone ? `https://wa.me/${lead.phone.replace(/[^\d]/g, '')}` : null;

  return (
    <Sheet
      open={!!lead}
      onOpenChange={(o) => !o && onClose()}
      title={lead?.name ?? ''}
      description={lead ? `${KIND[lead.kind].label} · received ${fmtDate(lead.createdAt, true)}` : undefined}
      footer={
        lead && (
          <>
            <Button
              variant="danger-outline"
              loading={remove.isPending}
              onClick={async () => {
                if (await confirm({ title: 'Delete this request?', description: 'It is removed for good. Mark it as spam instead if you only want it out of the list.', confirmLabel: 'Delete', danger: true })) remove.mutate();
              }}
            >
              <Trash2 /> Delete
            </Button>
            <Button onClick={() => save.mutate({ note: note.trim() || null })} loading={save.isPending && save.variables?.note !== undefined} disabled={note === (lead.note ?? '')}>
              Save note
            </Button>
          </>
        )
      }
    >
      {lead && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <a href={`mailto:${lead.email}?subject=${encodeURIComponent('Scholametrix — your request')}`} className={buttonClass('primary', 'sm')}>
              <Mail /> Email
            </a>
            {lead.phone && (
              <a href={`tel:${lead.phone.replace(/\s/g, '')}`} className={buttonClass('outline', 'sm')}>
                <Phone /> Call
              </a>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noreferrer" className={buttonClass('outline', 'sm')}>
                WhatsApp
              </a>
            )}
          </div>

          <Field label="Status" htmlFor="lead-status">
            <Select id="lead-status" value={lead.status} onChange={(e) => save.mutate({ status: e.target.value as LeadStatus })} disabled={save.isPending}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s].label}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <p className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Message</p>
            <p className="bg-surface-2 rounded-xl p-4 text-sm leading-relaxed whitespace-pre-wrap">{lead.message}</p>
          </div>

          <DefinitionList
            items={[
              ['Email', lead.email],
              ['Phone', lead.phone ?? '—'],
              ['Institution', lead.institution ?? '—'],
              [
                'Website',
                lead.website ? (
                  <a href={lead.website} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                    {lead.website}
                  </a>
                ) : (
                  '—'
                ),
              ],
              ['Role', lead.role ?? '—'],
              ['Country', lead.country ?? '—'],
              ['Size', lead.size ?? '—'],
              ['Sent from', lead.sourcePage ?? '—'],
              ['First follow-up', lead.contactedAt ? fmtDate(lead.contactedAt, true) : 'Not yet'],
            ]}
          />

          <Field label="Private note" htmlFor="lead-note" hint="Only console admins see this.">
            <Textarea id="lead-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Called on Monday, demo booked for…" />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
