import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { get } from '@/lib/api';
import { fmtInt, fmtMoney, fmtRelative, fmtUsd } from '@/lib/format';
import type { Client } from '@/lib/types';
import { ClientForm, type CreatedClient } from './ClientForm';
import { SecretsDialog } from './SecretsDialog';

export default function ClientsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['clients'], queryFn: ({ signal }) => get<Client[]>('/clients', signal) });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedClient | null>(null);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project is one customer’s software using your marking API. Create one to get its API key; the customer pastes it into their system to connect."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New project
          </Button>
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 />}
            title="No projects yet"
            description="Create one for each customer system that will send answers for marking — you get its API key straight away."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus /> New project
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Project</Th>
                <Th>Plan</Th>
                <Th>Status</Th>
                <Th>Last API call</Th>
                <Th className="text-right">Answers this month</Th>
                <Th className="text-right">AI cost</Th>
                <Th className="text-right">Billed so far</Th>
                <Th>Webhook</Th>
              </tr>
            </THead>
            <tbody>
              {q.data.map((c) => (
                <Tr key={c.id} onClick={() => navigate(`/projects/${c.id}`)}>
                  <Td>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-muted font-mono text-xs">{c.apiKeyHint}</p>
                  </Td>
                  <Td>{c.plan ? c.plan.name : <span className="text-muted">No plan</span>}</Td>
                  <Td>
                    <StatusBadge status={c.active ? 'active' : 'disabled'} />
                  </Td>
                  <Td className="text-muted text-[13px] whitespace-nowrap">{c.lastSeenAt ? fmtRelative(c.lastSeenAt) : 'Never'}</Td>
                  <TdNum>{fmtInt(c.month?.answers)}</TdNum>
                  <TdNum>{fmtUsd(c.month?.costUsd)}</TdNum>
                  <TdNum>{c.plan && c.month?.revenue !== null && c.month?.revenue !== undefined ? fmtMoney(c.month.revenue, c.plan.currency) : '—'}</TdNum>
                  <Td>{c.webhookUrl ? <Badge tone="success">Registered</Badge> : <Badge>Not yet</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {creating && <ClientForm open onOpenChange={setCreating} onCreated={setCreated} />}
      {created && (
        <SecretsDialog
          open
          onClose={() => {
            const id = created.client.id;
            setCreated(null);
            navigate(`/projects/${id}`);
          }}
          title={`${created.client.name}: API key created`}
          apiKey={created.apiKey}
          webhookSecret={created.webhookSecret}
        />
      )}
    </>
  );
}
