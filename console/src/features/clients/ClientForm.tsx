import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { errorMessage, patch, post } from '@/lib/api';
import type { Client } from '@/lib/types';
import { usePlans } from '../shared/queries';

export interface CreatedClient {
  client: Client;
  apiKey: string;
  webhookSecret: string;
}

export function ClientForm({
  open,
  onOpenChange,
  client,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client?: Client;
  onCreated?: (c: CreatedClient) => void;
}) {
  const qc = useQueryClient();
  const plans = usePlans();
  const [form, setForm] = useState(() => ({
    name: client?.name ?? '',
    webhookUrl: client?.webhookUrl ?? '',
    planId: client?.planId ?? '',
    monthlyBudgetUsd: client?.monthlyBudgetUsd?.toString() ?? '',
    contactName: client?.contactName ?? '',
    contactEmail: client?.contactEmail ?? '',
    billingAddress: client?.billingAddress ?? '',
    notes: client?.notes ?? '',
  }));
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        webhookUrl: form.webhookUrl.trim() || null,
        planId: form.planId || null,
        monthlyBudgetUsd: form.monthlyBudgetUsd.trim() === '' ? null : Number(form.monthlyBudgetUsd),
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        billingAddress: form.billingAddress,
        notes: form.notes,
      };
      return client ? { updated: await patch<Client>(`/clients/${client.id}`, body) } : { created: await post<CreatedClient>('/clients', body) };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      onOpenChange(false);
      if (res.created) onCreated?.(res.created);
      else toast.success('Project saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const activePlans = (plans.data ?? []).filter((p) => !p.archived || p.id === client?.planId);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={client ? `Edit ${client.name}` : 'New project'}
      description={client ? undefined : 'A project is one customer’s software that uses your marking API — for example a university’s e-Exam system. It gets its own API key, usage limit and monthly bill.'}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
            {client ? 'Save changes' : 'Create project and API key'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" htmlFor="c-name" className="sm:col-span-2" hint="Usually the customer and the software, so invoices are clear.">
          <Input id="c-name" value={form.name} onChange={set('name')} placeholder="University of Rajshahi — e-Exam" autoFocus />
        </Field>
        <Field
          label="Webhook URL (optional)"
          htmlFor="c-webhook"
          className="sm:col-span-2"
          hint="Leave empty: the project registers its own webhook when it connects. Set it only for software that can’t."
        >
          <Input id="c-webhook" value={form.webhookUrl} onChange={set('webhookUrl')} placeholder="https://exam.example.edu/api/v1/ai-marking/webhook" />
        </Field>
        <Field label="Pricing plan" htmlFor="c-plan" hint="What this project is billed. Without a plan it is not billed.">
          <Select id="c-plan" value={form.planId} onChange={set('planId')}>
            <option value="">No plan</option>
            {activePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.currency})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Monthly AI cost cap (USD)" htmlFor="c-budget" hint="Marking pauses for this project when its AI cost reaches this. The project only sees “usage limit reached”, never the amount. Empty = no cap.">
          <Input id="c-budget" type="number" min={0} step="0.01" value={form.monthlyBudgetUsd} onChange={set('monthlyBudgetUsd')} prefix="$" />
        </Field>
        <Field label="Billing contact" htmlFor="c-contact">
          <Input id="c-contact" value={form.contactName} onChange={set('contactName')} placeholder="Controller of Examinations" />
        </Field>
        <Field label="Billing email" htmlFor="c-email">
          <Input id="c-email" type="email" value={form.contactEmail} onChange={set('contactEmail')} />
        </Field>
        <Field label="Billing address" htmlFor="c-address" className="sm:col-span-2">
          <Textarea id="c-address" value={form.billingAddress} onChange={set('billingAddress')} className="min-h-[64px]" />
        </Field>
        <Field label="Internal notes" htmlFor="c-notes" className="sm:col-span-2">
          <Textarea id="c-notes" value={form.notes} onChange={set('notes')} className="min-h-[64px]" />
        </Field>
      </div>
    </Modal>
  );
}
