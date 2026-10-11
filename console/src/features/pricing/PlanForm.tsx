import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented, Switch } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { computeCharges } from '@/lib/billing';
import { errorMessage, patch, post } from '@/lib/api';
import { fmtInt, fmtMoney, fmtCost } from '@/lib/format';
import type { BillingModel, Plan } from '@/lib/types';
import { useBillingSettings, useUnitCosts } from '../shared/queries';
import { costBasis } from './costs';

type Num = string;
interface Form {
  name: string;
  currency: string;
  billingModel: BillingModel;
  monthlyFee: Num;
  includedAnswers: Num;
  pricePerAnswer: Num;
  pricePerRubricDraft: Num;
  markupPercent: Num;
  chargeBlank: boolean;
  chargeReused: boolean;
  taxPercent: Num;
  notes: string;
}

const n = (v: string) => (v.trim() === '' ? 0 : Number(v));

export function PlanForm({ open, onOpenChange, plan }: { open: boolean; onOpenChange: (o: boolean) => void; plan?: Plan }) {
  const qc = useQueryClient();
  const settings = useBillingSettings();
  const unit = useUnitCosts();
  const currencies = Object.keys(settings.data?.fxRates ?? { BDT: 122, USD: 1 });
  const [f, setF] = useState<Form>(() => ({
    name: plan?.name ?? '',
    currency: plan?.currency ?? settings.data?.defaultCurrency ?? 'BDT',
    billingModel: plan?.billingModel ?? 'per_answer',
    monthlyFee: String(plan?.monthlyFee ?? 0),
    includedAnswers: String(plan?.includedAnswers ?? 0),
    pricePerAnswer: String(plan?.pricePerAnswer ?? 0),
    pricePerRubricDraft: String(plan?.pricePerRubricDraft ?? 0),
    markupPercent: String(plan?.markupPercent ?? 200),
    chargeBlank: plan?.chargeBlank ?? false,
    chargeReused: plan?.chargeReused ?? true,
    taxPercent: String(plan?.taxPercent ?? 0),
    notes: plan?.notes ?? '',
  }));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const [volume, setVolume] = useState('5000');

  const terms = {
    currency: f.currency,
    billingModel: f.billingModel,
    monthlyFee: n(f.monthlyFee),
    includedAnswers: Math.round(n(f.includedAnswers)),
    pricePerAnswer: n(f.pricePerAnswer),
    pricePerRubricDraft: n(f.pricePerRubricDraft),
    markupPercent: n(f.markupPercent),
    chargeBlank: f.chargeBlank,
    chargeReused: f.chargeReused,
    taxPercent: n(f.taxPercent),
  };

  const fx = settings.data?.fxRates[f.currency] ?? (f.currency === 'USD' ? 1 : 0);
  const basis = costBasis(unit.data);
  const preview = (() => {
    if (basis.perAnswerUsd === null || !fx) return null;
    const answers = Math.max(0, Math.round(n(volume)));
    // Roughly one new question per 100 answers.
    const drafts = Math.round(answers / 100);
    const costUsd = answers * basis.perAnswerUsd + drafts * (basis.perDraftUsd ?? 0);
    return { answers, drafts, charges: computeCharges({ completed: answers, blank: 0, reused: 0, failed: 0, rubricDrafts: drafts, costUsd }, terms, fx) };
  })();

  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), ...terms, notes: f.notes.trim() || null };
      return plan ? patch<Plan>(`/plans/${plan.id}`, body) : post<Plan>('/plans', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      qc.invalidateQueries({ queryKey: ['billing'] });
      toast.success(plan ? 'Plan saved' : 'Plan created');
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const money = (label: string, k: keyof Form, hint?: string) => (
    <Field label={label} htmlFor={`pl-${k}`} hint={hint}>
      <Input id={`pl-${k}`} type="number" min={0} step="0.01" value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} suffix={f.currency} />
    </Field>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      dismissible={false}
      title={plan ? `Edit ${plan.name}` : 'New pricing plan'}
      description="What a client pays each month. Invoices already created keep the prices they were made with."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Plan name" htmlFor="pl-name">
              <Input id="pl-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="University standard" autoFocus />
            </Field>
            <Field label="Currency" htmlFor="pl-cur">
              <Select id="pl-cur" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="How you charge">
            <Segmented
              value={f.billingModel}
              onChange={(v) => set('billingModel', v)}
              options={[
                { value: 'per_answer', label: 'Per answer' },
                { value: 'cost_plus', label: 'AI cost + markup' },
              ]}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {money('Monthly subscription', 'monthlyFee', 'Charged every month, even with no usage. 0 = pay as you go.')}
            {f.billingModel === 'per_answer' ? (
              <>
                <Field label="Answers included" htmlFor="pl-inc" hint="Covered by the subscription each month.">
                  <Input id="pl-inc" type="number" min={0} step={100} value={f.includedAnswers} onChange={(e) => set('includedAnswers', e.target.value)} />
                </Field>
                {money(n(f.includedAnswers) > 0 ? 'Price per extra answer' : 'Price per answer', 'pricePerAnswer')}
              </>
            ) : (
              <Field label="Markup on AI cost" htmlFor="pl-markup" hint="200% = the client pays three times your AI cost.">
                <Input id="pl-markup" type="number" min={0} step={10} value={f.markupPercent} onChange={(e) => set('markupPercent', e.target.value)} suffix="%" />
              </Field>
            )}
            {money('Price per AI rubric draft', 'pricePerRubricDraft', '0 = included')}
            <Field label="Tax / VAT" htmlFor="pl-tax" hint="Added on top of the subtotal.">
              <Input id="pl-tax" type="number" min={0} max={100} step="0.5" value={f.taxPercent} onChange={(e) => set('taxPercent', e.target.value)} suffix="%" />
            </Field>
          </div>
          <div className="grid gap-3 rounded-lg border p-4">
            <Switch checked={f.chargeReused} onChange={(v) => set('chargeReused', v)} label="Charge for reused answers" description="Identical answers to the same question reuse an earlier result and cost you nothing." />
            <Switch checked={f.chargeBlank} onChange={(v) => set('chargeBlank', v)} label="Charge for blank answers" description="Blank answers get 0 without calling the model." />
          </div>
          <Field label="Notes" htmlFor="pl-notes">
            <Textarea id="pl-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-[60px]" />
          </Field>
        </div>

        <aside className="bg-surface-2/60 h-fit space-y-4 rounded-xl border p-4">
          <div>
            <p className="text-sm font-semibold">Example month</p>
            <p className="text-muted text-xs">With your {basis.measured ? 'measured' : 'estimated'} AI cost of {fmtCost(basis.perAnswerUsd)} per answer.</p>
          </div>
          <Field label="Answers marked" htmlFor="pl-vol">
            <Input id="pl-vol" type="number" min={0} step={500} value={volume} onChange={(e) => setVolume(e.target.value)} />
          </Field>
          {!preview ? (
            <p className="text-muted text-xs">{fx ? 'Loading costs…' : `Add an exchange rate for ${f.currency} under Settings.`}</p>
          ) : (
            <div className="space-y-2 text-[13px]">
              {preview.charges.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span className="text-muted">{l.description}</span>
                  <span className="tabular">{fmtMoney(l.amount, f.currency)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t pt-2 font-medium">
                <span>Client pays{terms.taxPercent ? ' (incl. tax)' : ''}</span>
                <span className="tabular">{fmtMoney(preview.charges.total, f.currency)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Your AI cost</span>
                <span className="tabular">{fmtMoney(preview.charges.cost, f.currency)}</span>
              </div>
              <div className="flex justify-between gap-3 font-medium">
                <span>Margin</span>
                <span className={`tabular ${preview.charges.margin < 0 ? 'text-danger' : 'text-success'}`}>
                  {fmtMoney(preview.charges.margin, f.currency)}
                  {preview.charges.marginPercent !== null && ` · ${preview.charges.marginPercent}%`}
                </span>
              </div>
              <p className="text-muted pt-1 text-xs">
                Effective price {preview.answers ? fmtMoney(preview.charges.subtotal / preview.answers, f.currency) : '—'} per answer · {fmtInt(preview.drafts)} rubric drafts assumed
              </p>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}
