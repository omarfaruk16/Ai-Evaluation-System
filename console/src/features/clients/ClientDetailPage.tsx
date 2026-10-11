import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, KeyRound, MoreHorizontal, Pencil, Power, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { CopyButton } from '@/components/ui/controls';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { DefinitionList, EmptyState, ErrorState, PageSkeleton, Stat } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { errorMessage, get, patch, post } from '@/lib/api';
import { useApiBaseUrl } from '@/lib/auth';
import { fmtDate, fmtInt, fmtMoney, fmtMonth, fmtPct, fmtRelative, fmtCost } from '@/lib/format';
import { maskSecret } from '@/lib/mask';
import type { Client, ClientDetail } from '@/lib/types';
import { BarsChart, ChartFrame } from '../shared/charts';
import { ClientForm } from './ClientForm';
import { SecretsDialog } from './SecretsDialog';

export default function ClientDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const apiBase = useApiBaseUrl();
  const q = useQuery({ queryKey: ['clients', id], queryFn: ({ signal }) => get<ClientDetail>(`/clients/${id}`, signal) });
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState<{ title: string; apiKey?: string; webhookSecret?: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['clients'] });
  const rotateKey = useMutation({
    mutationFn: () => post<{ apiKey: string }>(`/clients/${id}/rotate-key`),
    onSuccess: (r) => {
      refresh();
      setSecret({ title: 'New API key', apiKey: r.apiKey });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rotateSecret = useMutation({
    mutationFn: () => post<{ webhookSecret: string }>(`/clients/${id}/rotate-webhook-secret`),
    onSuccess: (r) => {
      refresh();
      setSecret({ title: 'New webhook signing secret', webhookSecret: r.webhookSecret });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (active: boolean) => patch<Client>(`/clients/${id}`, { active }),
    onSuccess: (c) => {
      refresh();
      toast.success(c.active ? 'Project enabled' : 'Project disabled — its API key is refused now');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ping = useMutation({
    mutationFn: () => post<{ ok: boolean; status: number | null; latencyMs: number; body: string }>(`/clients/${id}/test-webhook`),
    onSuccess: (r) =>
      r.ok
        ? toast.success(`Webhook answered ${r.status} in ${r.latencyMs} ms`)
        : toast.error(`Webhook failed${r.status ? ` (HTTP ${r.status})` : ''}: ${r.body || 'no response'}`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { client: c, months, evaluations, webhooks, invoices } = q.data;
  const current = months[months.length - 1]!;
  const currency = c.plan?.currency ?? 'USD';
  const chart = months.map((m) => ({
    month: m.month,
    billed: m.charges?.subtotal ?? 0,
    cost: m.charges?.cost ?? m.usage.costUsd,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/projects" className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-[13px]">
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight sm:text-[22px]">{c.name}</h1>
              <StatusBadge status={c.active ? 'active' : 'disabled'} />
            </div>
            <p className="text-muted mt-1 text-sm">
              Key <code className="font-mono">{c.apiKeyHint}</code> · created {fmtDate(c.createdAt)} · last API call{' '}
              {c.lastSeenAt ? fmtRelative(c.lastSeenAt) : 'never'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" onClick={() => ping.mutate()} loading={ping.isPending} disabled={!c.webhookUrl}>
              <Send /> Test webhook
            </Button>
            <Menu
              trigger={
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              }
            >
              <MenuItem
                onSelect={async () => {
                  if (
                    await confirm({
                      title: 'Rotate the API key?',
                      description: 'The current key stops working at once. The project’s administrator must reconnect with the new key (exam system: AI Marking → Replace key).',
                      confirmLabel: 'Rotate key',
                      danger: true,
                    })
                  )
                    rotateKey.mutate();
                }}
              >
                <KeyRound /> Rotate API key
              </MenuItem>
              <MenuItem
                onSelect={async () => {
                  if (
                    await confirm({
                      title: 'Rotate the webhook secret?',
                      description: 'Webhooks are signed with the new secret immediately; the project rejects them until it has it. Projects that registered their own webhook can just reconnect instead.',
                      confirmLabel: 'Rotate secret',
                      danger: true,
                    })
                  )
                    rotateSecret.mutate();
                }}
              >
                <ShieldCheck /> Rotate webhook secret
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                danger={c.active}
                onSelect={async () => {
                  if (
                    !c.active ||
                    (await confirm({
                      title: `Disable ${c.name}?`,
                      description: 'Its API key is refused until you enable it again (the customer sees “invalid or disabled API key”). Work already queued still finishes.',
                      confirmLabel: 'Disable',
                      danger: true,
                    }))
                  )
                    toggle.mutate(!c.active);
                }}
              >
                <Power /> {c.active ? 'Disable project' : 'Enable project'}
              </MenuItem>
            </Menu>
          </div>
        </div>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label={`Answers in ${fmtMonth(current.month)}`} value={fmtInt(current.usage.completed)} sub={`${fmtInt(current.usage.failed)} failed · ${fmtInt(current.usage.rubricDrafts)} rubric drafts`} />
        <Stat label="AI cost this month" value={fmtCost(current.usage.costUsd)} sub={c.monthlyBudgetUsd !== null ? `Budget ${fmtCost(c.monthlyBudgetUsd)} · ${fmtPct(current.usage.costUsd / (c.monthlyBudgetUsd || 1), 0)} used` : 'No budget cap'} />
        <Stat label="Billed so far" value={current.charges ? fmtMoney(current.charges.subtotal, currency) : '—'} sub={c.plan ? `${c.plan.name} plan` : 'No pricing plan'} />
        <Stat
          label="Margin this month"
          value={current.charges ? fmtMoney(current.charges.margin, currency) : '—'}
          tone={current.charges && current.charges.margin < 0 ? 'danger' : undefined}
          sub={current.charges?.marginPercent !== null && current.charges ? `${current.charges.marginPercent}% of the bill` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody>
            <ChartFrame title={`Billed vs AI cost, last 6 months (${currency})`}>
              <BarsChart
                data={chart}
                x="month"
                series={[
                  { key: 'billed', label: 'Billed (before tax)', format: (v) => fmtMoney(v, currency) },
                  { key: 'cost', label: 'Your AI cost', format: (v) => fmtMoney(v, currency) },
                ]}
                xFormat={(m) => fmtMonth(m).slice(0, 3)}
                labelFormat={fmtMonth}
              />
            </ChartFrame>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Connection" description="What the customer enters in their system, and whether it is connected." />
          <CardBody className="space-y-3 text-sm">
            <div>
              <p className="text-muted mb-1 text-xs">API URL</p>
              <div className="flex items-center gap-2">
                <code className="bg-surface-2 min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-xs">{apiBase}</code>
                <CopyButton value={apiBase} />
              </div>
            </div>
            <ProjectKey client={c} onRotate={() => rotateKey.mutate()} rotating={rotateKey.isPending} />
            <div>
              <p className="text-muted mb-1 text-xs">Status</p>
              <p className="text-[13px]">
                {c.lastSeenAt ? (
                  <span className="text-success font-medium">Connected · last call {fmtRelative(c.lastSeenAt)}</span>
                ) : (
                  <span className="text-warning font-medium">Not connected yet</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-muted mb-1 text-xs">Webhook</p>
              <p className="font-mono text-xs break-all">{c.webhookUrl ?? 'Not registered — the project registers it when it connects'}</p>
            </div>
            <div>
              <p className="text-muted mb-1 text-xs">Evaluations so far</p>
              <p className="text-[13px]">
                {(['completed', 'failed', 'queued', 'running'] as const)
                  .filter((s) => evaluations[s])
                  .map((s) => `${fmtInt(evaluations[s])} ${s}`)
                  .join(' · ') || 'None yet'}
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Billing details" />
          <CardBody>
            <DefinitionList
              items={[
                ['Plan', c.plan ? <Link className="text-primary hover:underline" to="/pricing">{c.plan.name}</Link> : 'None'],
                ['Contact', c.contactName || '—'],
                ['Email', c.contactEmail || '—'],
                ['Address', c.billingAddress ? <span className="whitespace-pre-line">{c.billingAddress}</span> : '—'],
                ['AI budget', c.monthlyBudgetUsd !== null ? `${fmtCost(c.monthlyBudgetUsd)} per month` : 'No cap'],
                ['Notes', c.notes ? <span className="whitespace-pre-line">{c.notes}</span> : '—'],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Invoices"
            actions={
              <Link to="/billing" className="text-primary text-[13px] font-medium hover:underline">
                Statements
              </Link>
            }
          />
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" description="Create one from the monthly statement." />
          ) : (
            <Table stack={false}>
              <tbody>
                {invoices.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link to={`/billing/invoices/${i.id}`} className="font-medium hover:underline">
                        {i.number}
                      </Link>
                      <p className="text-muted text-xs">{fmtMonth(i.month)}</p>
                    </Td>
                    <Td>
                      <StatusBadge status={i.status} />
                    </Td>
                    <TdNum>{fmtMoney(i.total, i.currency)}</TdNum>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent webhooks"
          actions={
            <Link to={`/webhooks?clientId=${c.id}`} className="text-primary text-[13px] font-medium hover:underline">
              All deliveries
            </Link>
          }
        />
        {webhooks.length === 0 ? (
          <EmptyState title="No webhooks sent yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Event</Th>
                <Th>Status</Th>
                <Th className="text-right">Attempts</Th>
                <Th>Last response</Th>
                <Th>When</Th>
              </tr>
            </THead>
            <tbody>
              {webhooks.map((w) => (
                <Tr key={w.id}>
                  <Td className="font-mono text-xs">{w.event}</Td>
                  <Td>
                    <StatusBadge status={w.status} />
                  </Td>
                  <TdNum>{w.attempts}</TdNum>
                  <Td className="text-muted text-xs">{w.lastError ?? (w.lastStatusCode ? `HTTP ${w.lastStatusCode}` : '—')}</Td>
                  <Td className="text-muted text-xs">{fmtRelative(w.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <ClientForm open onOpenChange={setEditing} client={c} />}
      {secret && <SecretsDialog open onClose={() => setSecret(null)} title={secret.title} apiKey={secret.apiKey} webhookSecret={secret.webhookSecret} />}
    </div>
  );
}

/** The project's API key: masked, with Show and Copy, so it can be handed out again at any time. */
function ProjectKey({ client: c, onRotate, rotating }: { client: Client; onRotate: () => void; rotating: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const reveal = useMutation({
    mutationFn: () => post<{ apiKey: string }>(`/clients/${c.id}/reveal-key`),
    onSuccess: (r) => setKey(r.apiKey),
    onError: (e) => toast.error(errorMessage(e)),
  });

  // A rotation replaces the key; drop the copy fetched for the old one.
  const [hint, setHint] = useState(c.apiKeyHint);
  if (hint !== c.apiKeyHint) {
    setHint(c.apiKeyHint);
    setKey(null);
    setShown(false);
  }

  return (
    <div>
      <p className="text-muted mb-1 text-xs">API key</p>
      {!c.apiKeyStored ? (
        <div className="space-y-1.5">
          <p className="font-mono text-xs">{c.apiKeyHint}</p>
          <p className="text-muted text-xs leading-relaxed">
            This key was created before keys were saved, so it can’t be shown.{' '}
            <button type="button" className="text-primary font-medium hover:underline disabled:opacity-50" onClick={onRotate} disabled={rotating}>
              Rotate it once
            </button>{' '}
            — after that it can always be copied here. The project must then reconnect with the new key.
          </p>
        </div>
      ) : key ? (
        <div className="flex items-center gap-1">
          <code className="bg-surface-2 min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-xs" aria-label={shown ? 'API key' : 'API key, hidden'}>
            {shown ? key : maskSecret(key)}
          </code>
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            className="text-muted hover:bg-surface-3 hover:text-foreground rounded-md p-1.5 pointer-coarse:p-2.5"
            aria-label={shown ? 'Hide key' : 'Show key'}
            title={shown ? 'Hide key' : 'Show key'}
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
          <CopyButton value={key} onFail={() => setShown(true)} />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <code className="bg-surface-2 min-w-0 flex-1 truncate rounded px-2 py-1 font-mono text-xs">{c.apiKeyHint}</code>
          <Button variant="outline" size="sm" onClick={() => reveal.mutate()} loading={reveal.isPending}>
            <KeyRound /> Get key
          </Button>
        </div>
      )}
    </div>
  );
}
