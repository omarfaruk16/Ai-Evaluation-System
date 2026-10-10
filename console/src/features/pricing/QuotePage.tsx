import { Info, RotateCcw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyButton, Segmented, Switch } from '@/components/ui/controls';
import { Field, Input, Select } from '@/components/ui/input';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { computeCharges, estimateAnswerCostUsd, estimateRubricDraftUsd, type PlanTerms } from '@/lib/billing';
import { fmtInt, fmtMoney, fmtNum, fmtPct, fmtCost, fmtUsd } from '@/lib/format';
import type { Plan, Prices, UnitCosts } from '@/lib/types';
import { LinesChart } from '../shared/charts';
import { useBillingSettings, useModels, usePlans, useUnitCosts } from '../shared/queries';
import { DEFAULT_ASSUMPTIONS } from './costs';

const LANGUAGES = {
  english: { label: 'English', tokensPerWord: 1.4 },
  mixed: { label: 'Mixed', tokensPerWord: 2.2 },
  bangla: { label: 'Bangla', tokensPerWord: 3.0 },
} as const;

type PricingMode = 'plan' | 'custom' | 'target';

const START = {
  clientName: '',
  students: '3000',
  examsPerMonth: '1.5',
  questionsPerExam: '5',
  answerRate: '90',
  blankRate: '5',
  reuseRate: '2',
  newQuestions: '150',
  answerWords: String(DEFAULT_ASSUMPTIONS.answerWords),
  language: 'mixed' as keyof typeof LANGUAGES,
  tokensPerWord: String(LANGUAGES.mixed.tokensPerWord),
  cacheShare: '0',
  overhead: '5',
  profileId: '',
  useMeasured: true,
  mode: 'target' as PricingMode,
  planId: '',
  currency: '',
  fx: '',
  monthlyFee: '0',
  includedAnswers: '0',
  pricePerAnswer: '2',
  pricePerDraft: '0',
  taxPercent: '0',
  targetMargin: '70',
};

const num = (v: string, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export default function QuotePage() {
  const unit = useUnitCosts(90);
  const models = useModels();
  const plans = usePlans();
  const settings = useBillingSettings();
  if (unit.isPending || models.isPending || plans.isPending || settings.isPending) return <PageSkeleton />;
  const err = unit.error ?? models.error ?? plans.error ?? settings.error;
  if (err || !unit.data || !models.data || !plans.data || !settings.data) return <ErrorState error={err} onRetry={() => unit.refetch()} />;
  return <Calculator unit={unit.data} profiles={models.data.profiles.filter((p) => !p.archived)} plans={plans.data.filter((p) => !p.archived)} fxRates={settings.data.fxRates} defaultCurrency={settings.data.defaultCurrency} />;
}

function Calculator({
  unit,
  profiles,
  plans,
  fxRates,
  defaultCurrency,
}: {
  unit: UnitCosts;
  profiles: { id: string; name: string; prices: Prices }[];
  plans: Plan[];
  fxRates: Record<string, number>;
  defaultCurrency: string;
}) {
  const initial = { ...START, profileId: unit.markingProfile.id ?? profiles[0]?.id ?? '', currency: defaultCurrency };
  const [s, setS] = useState(initial);
  const set = <K extends keyof typeof START>(k: K, v: (typeof START)[K]) => setS((x) => ({ ...x, [k]: v }));

  const plan = plans.find((p) => p.id === s.planId);
  const currency = s.mode === 'plan' && plan ? plan.currency : s.currency;
  const fx = s.fx.trim() !== '' ? num(s.fx, 0) : (fxRates[currency] ?? 0);
  const prices = profiles.find((p) => p.id === s.profileId)?.prices ?? unit.markingProfile.prices;
  const measuredOk = unit.sample.aiMarked >= 50 && unit.costPerAnswerUsd !== null;

  const r = useMemo(() => {
    // Volume
    const answers = num(s.students) * num(s.examsPerMonth) * num(s.questionsPerExam) * (num(s.answerRate) / 100);
    const blank = answers * (num(s.blankRate) / 100);
    const reused = (answers - blank) * (num(s.reuseRate) / 100);
    const modelMarked = Math.max(0, answers - blank - reused);
    const drafts = num(s.newQuestions);

    // Your cost
    const est = estimateAnswerCostUsd(
      {
        promptBaseTokens: unit.promptBaseTokens,
        questionTokens: DEFAULT_ASSUMPTIONS.questionTokens,
        answerWords: num(s.answerWords),
        tokensPerWord: num(s.tokensPerWord, 1.4),
        outputTokens: unit.perMarkingCall.outputTokens ?? DEFAULT_ASSUMPTIONS.outputTokens,
        cacheShare: num(s.cacheShare) / 100,
        overhead: num(s.overhead) / 100,
      },
      prices,
    );
    const perAnswerUsd = s.useMeasured && measuredOk ? unit.costPerAnswerUsd! : est.perAnswer;
    const perDraftUsd = unit.sample.rubricDrafts >= 10 && unit.costPerRubricDraftUsd !== null && s.useMeasured ? unit.costPerRubricDraftUsd : estimateRubricDraftUsd(prices);
    const costUsd = modelMarked * perAnswerUsd + drafts * perDraftUsd;

    // What the client pays
    const target = Math.min(95, Math.max(0, num(s.targetMargin))) / 100;
    const suggestedPerAnswer = fx ? (perAnswerUsd * fx) / (1 - target) : 0;
    const suggestedPerDraft = fx ? (perDraftUsd * fx) / (1 - target) : 0;
    const terms: PlanTerms =
      s.mode === 'plan' && plan
        ? plan
        : {
            currency,
            billingModel: 'per_answer',
            monthlyFee: num(s.monthlyFee),
            includedAnswers: s.mode === 'custom' ? Math.round(num(s.includedAnswers)) : 0,
            pricePerAnswer: s.mode === 'target' ? Math.ceil(suggestedPerAnswer * 100) / 100 : num(s.pricePerAnswer),
            pricePerRubricDraft: s.mode === 'target' ? Math.ceil(suggestedPerDraft * 100) / 100 : num(s.pricePerDraft),
            markupPercent: 0,
            chargeBlank: false,
            chargeReused: true,
            taxPercent: num(s.taxPercent),
          };
    const usageFor = (n: number) => {
      const b = n * (num(s.blankRate) / 100);
      const ru = (n - b) * (num(s.reuseRate) / 100);
      const mm = Math.max(0, n - b - ru);
      return { completed: Math.round(n), blank: Math.round(b), reused: Math.round(ru), failed: 0, rubricDrafts: Math.round(drafts), costUsd: mm * perAnswerUsd + drafts * perDraftUsd };
    };
    const charges = fx ? computeCharges(usageFor(answers), terms, fx) : null;

    // Billed and cost across volumes, for the chart and break-even.
    const maxN = Math.max(1000, answers * 2.5);
    const curve = Array.from({ length: 26 }, (_, i) => {
      const n = (maxN / 25) * i;
      const c = fx ? computeCharges(usageFor(n), terms, fx) : null;
      return { answers: Math.round(n), billed: c?.subtotal ?? 0, cost: c?.cost ?? 0 };
    });
    let breakEven: number | null = null;
    for (const p of curve) {
      if (p.billed >= p.cost && p.answers > 0) {
        breakEven = p.answers;
        break;
      }
    }
    return { answers, blank, reused, modelMarked, drafts, est, perAnswerUsd, perDraftUsd, costUsd, terms, charges, curve, breakEven, suggestedPerAnswer };
  }, [s, unit, prices, fx, currency, plan, measuredOk]);

  const students = num(s.students);
  const quote = r.charges
    ? [
        `AI marking quote${s.clientName ? ` — ${s.clientName}` : ''}`,
        ``,
        `Expected volume: about ${fmtInt(r.answers)} written answers per month (${fmtInt(students)} students).`,
        ...r.charges.lines.map((l) => `• ${l.description}: ${l.quantity !== 1 ? `${fmtInt(l.quantity)} × ${fmtMoney(l.unitPrice, currency)} = ` : ''}${fmtMoney(l.amount, currency)}`),
        r.charges.tax ? `• Tax (${r.terms.taxPercent}%): ${fmtMoney(r.charges.tax, currency)}` : null,
        `Estimated monthly total: ${fmtMoney(r.charges.total, currency)} (${fmtMoney(r.charges.total * 12, currency)} per year)`,
        students ? `That is about ${fmtMoney(r.charges.total / students, currency)} per student per month.` : null,
        ``,
        `Included: rubric-based mark suggestions with explanations, highlighted strengths and weaknesses, and identical-answer reuse. Teachers approve every mark.`,
      ]
        .filter((l) => l !== null)
        .join('\n')
    : '';

  return (
    <>
      <PageHeader
        title="Quote calculator"
        description="Work out what a new client should pay. Your cost per answer comes from real traffic when there is enough of it, otherwise from the model’s prices."
        actions={
          <>
            <Button variant="outline" onClick={() => setS(initial)}>
              <RotateCcw /> Reset
            </Button>
            {quote && <CopyButton value={quote} label="Copy quote" className="border-input bg-surface h-9 border px-3 text-sm shadow-card" />}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="The client" description="How many written answers they will send each month." />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Client name" htmlFor="q-name" className="sm:col-span-3">
                <Input id="q-name" value={s.clientName} onChange={(e) => set('clientName', e.target.value)} placeholder="Optional — used in the quote text" />
              </Field>
              <NumField id="q-students" label="Students" value={s.students} onChange={(v) => set('students', v)} step={100} />
              <NumField id="q-exams" label="Exams per student per month" value={s.examsPerMonth} onChange={(v) => set('examsPerMonth', v)} step={0.5} />
              <NumField id="q-qpe" label="Written questions per exam" value={s.questionsPerExam} onChange={(v) => set('questionsPerExam', v)} />
              <NumField id="q-rate" label="Questions answered" value={s.answerRate} onChange={(v) => set('answerRate', v)} suffix="%" />
              <NumField id="q-blank" label="Left blank" value={s.blankRate} onChange={(v) => set('blankRate', v)} suffix="%" hint="Free for you: no model call" />
              <NumField id="q-reuse" label="Identical answers" value={s.reuseRate} onChange={(v) => set('reuseRate', v)} suffix="%" hint="Reuse an earlier result" />
              <NumField id="q-newq" label="New questions per month" value={s.newQuestions} onChange={(v) => set('newQuestions', v)} step={10} hint="Each gets one AI rubric draft" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your cost" description="What one model-marked answer costs you." />
            <CardBody className="space-y-4">
              {measuredOk ? (
                <Switch
                  checked={s.useMeasured}
                  onChange={(v) => set('useMeasured', v)}
                  label={`Use measured cost: ${fmtCost(unit.costPerAnswerUsd)} per answer`}
                  description={`From ${fmtInt(unit.sample.aiMarked)} answers marked in the last ${unit.days} days, including retries.`}
                />
              ) : (
                <p className="bg-info-soft text-info flex gap-2 rounded-lg px-3 py-2 text-[13px]">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  Not enough real traffic yet ({fmtInt(unit.sample.aiMarked)} answers) — using an estimate from the model’s prices.
                </p>
              )}
              <div className={`grid gap-4 sm:grid-cols-3 ${s.useMeasured && measuredOk ? 'pointer-events-none opacity-50' : ''}`}>
                <Field label="Model profile" htmlFor="q-profile" className="sm:col-span-2">
                  <Select id="q-profile" value={s.profileId} onChange={(e) => set('profileId', e.target.value)}>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — ${fmtNum(p.prices.input, 3)} in / ${fmtNum(p.prices.output, 3)} out
                      </option>
                    ))}
                  </Select>
                </Field>
                <NumField id="q-words" label="Average answer length" value={s.answerWords} onChange={(v) => set('answerWords', v)} suffix="words" step={10} />
                <Field label="Answer language" className="sm:col-span-2">
                  <Segmented
                    value={s.language}
                    onChange={(v) => setS((x) => ({ ...x, language: v, tokensPerWord: String(LANGUAGES[v].tokensPerWord) }))}
                    options={Object.entries(LANGUAGES).map(([value, l]) => ({ value: value as keyof typeof LANGUAGES, label: l.label }))}
                  />
                </Field>
                <NumField id="q-tpw" label="Tokens per word" value={s.tokensPerWord} onChange={(v) => set('tokensPerWord', v)} step={0.1} hint="Bangla script uses more tokens" />
                <NumField id="q-cache" label="Prompt cache hits" value={s.cacheShare} onChange={(v) => set('cacheShare', v)} suffix="%" hint="If the host caches prompts" />
                <NumField id="q-over" label="Retries and failures" value={s.overhead} onChange={(v) => set('overhead', v)} suffix="%" />
              </div>
              <p className="text-muted text-xs">
                Estimate: about {fmtInt(r.est.inputTokens)} input and {fmtInt(unit.perMarkingCall.outputTokens ?? DEFAULT_ASSUMPTIONS.outputTokens)} output tokens per answer →{' '}
                {fmtCost(r.est.perAnswer)} per answer, {fmtCost(r.perDraftUsd)} per rubric draft.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="What the client pays"
              actions={
                <Segmented
                  size="sm"
                  value={s.mode}
                  onChange={(v) => set('mode', v)}
                  options={[
                    { value: 'target', label: 'Target margin' },
                    { value: 'custom', label: 'Custom price' },
                    { value: 'plan', label: 'Existing plan' },
                  ]}
                />
              }
            />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              {s.mode === 'plan' ? (
                <Field label="Plan" htmlFor="q-plan" className="sm:col-span-2">
                  <Select id="q-plan" value={s.planId} onChange={(e) => set('planId', e.target.value)}>
                    <option value="">Choose a plan</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.currency})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <>
                  <Field label="Currency" htmlFor="q-cur">
                    <Select id="q-cur" value={s.currency} onChange={(e) => setS((x) => ({ ...x, currency: e.target.value, fx: '' }))}>
                      {Object.keys(fxRates).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <NumField id="q-fee" label="Monthly subscription" value={s.monthlyFee} onChange={(v) => set('monthlyFee', v)} suffix={currency} step={500} />
                  {s.mode === 'target' ? (
                    <NumField id="q-margin" label="Target margin" value={s.targetMargin} onChange={(v) => set('targetMargin', v)} suffix="%" step={5} hint="Of the bill, before tax" />
                  ) : (
                    <>
                      <NumField id="q-inc" label="Answers included" value={s.includedAnswers} onChange={(v) => set('includedAnswers', v)} step={500} />
                      <NumField id="q-ppa" label={num(s.includedAnswers) > 0 ? 'Price per extra answer' : 'Price per answer'} value={s.pricePerAnswer} onChange={(v) => set('pricePerAnswer', v)} suffix={currency} step={0.1} />
                      <NumField id="q-ppd" label="Price per rubric draft" value={s.pricePerDraft} onChange={(v) => set('pricePerDraft', v)} suffix={currency} step={1} />
                    </>
                  )}
                  <NumField id="q-tax" label="Tax / VAT" value={s.taxPercent} onChange={(v) => set('taxPercent', v)} suffix="%" />
                </>
              )}
              <NumField
                id="q-fx"
                label={`1 USD in ${currency}`}
                value={s.fx === '' ? String(fxRates[currency] ?? '') : s.fx}
                onChange={(v) => set('fx', v)}
                step={0.5}
                hint={s.fx === '' ? 'From billing settings' : 'Changed for this quote only'}
              />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader title="Monthly estimate" description={`${fmtInt(r.answers)} answers · ${fmtInt(r.modelMarked)} marked by the model · ${fmtInt(r.drafts)} rubric drafts`} />
            {!r.charges ? (
              <CardBody>
                <p className="text-muted text-sm">{s.mode === 'plan' && !plan ? 'Choose a plan.' : `Set an exchange rate for ${currency}.`}</p>
              </CardBody>
            ) : (
              <CardBody className="space-y-4">
                <div className="space-y-2 text-[13px]">
                  {r.charges.lines.map((l, i) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span className="text-muted">
                        {l.description}
                        {l.quantity !== 1 && l.unitPrice > 0 && (
                          <span className="block text-xs">
                            {fmtInt(l.quantity)} × {fmtMoney(l.unitPrice, currency)}
                          </span>
                        )}
                      </span>
                      <span className="tabular">{fmtMoney(l.amount, currency)}</span>
                    </div>
                  ))}
                  {r.charges.tax > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">Tax ({r.terms.taxPercent}%)</span>
                      <span className="tabular">{fmtMoney(r.charges.tax, currency)}</span>
                    </div>
                  )}
                </div>
                <div className="bg-surface-2 rounded-lg px-4 py-3">
                  <p className="text-muted text-xs">Client pays per month</p>
                  <p className="tabular text-2xl font-semibold tracking-tight">{fmtMoney(r.charges.total, currency)}</p>
                  <p className="text-muted text-xs">
                    {fmtMoney(r.charges.total * 12, currency)} per year{students ? ` · ${fmtMoney(r.charges.total / students, currency)} per student per month` : ''}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Result label="Your AI cost / month" value={fmtMoney(r.charges.cost, currency)} sub={`${fmtUsd(r.costUsd)} · ${fmtUsd(r.perAnswerUsd)} per answer`} />
                  <Result
                    label="Your margin / month"
                    value={fmtMoney(r.charges.margin, currency)}
                    sub={r.charges.marginPercent !== null ? `${r.charges.marginPercent}% of the bill` : undefined}
                    tone={r.charges.margin < 0 ? 'danger' : 'success'}
                  />
                </div>
                <p className="text-muted text-xs leading-relaxed">
                  {s.mode === 'target'
                    ? `Price per answer for ${s.targetMargin}% margin: ${fmtMoney(r.suggestedPerAnswer, currency)} (rounded up to ${fmtMoney(r.terms.pricePerAnswer, currency)}).`
                    : r.breakEven !== null
                      ? `Break-even at about ${fmtInt(r.breakEven)} answers per month.`
                      : 'No break-even in this range — the price is below your cost.'}{' '}
                  AI cost is {fmtPct(r.charges.subtotal ? r.charges.cost / r.charges.subtotal : null, 1)} of the bill.
                </p>
              </CardBody>
            )}
          </Card>
          {r.charges && (
            <Card>
              <CardBody>
                <p className="mb-3 text-[13px] font-medium">Billed vs your cost as volume changes ({currency})</p>
                <LinesChart
                  data={r.curve}
                  x="answers"
                  xType="number"
                  series={[
                    { key: 'billed', label: 'Client pays (before tax)', format: (v) => fmtMoney(v, currency) },
                    { key: 'cost', label: 'Your AI cost', format: (v) => fmtMoney(v, currency) },
                  ]}
                  xFormat={(v) => fmtInt(Number(v))}
                  yFormat={(v) => fmtMoney(v, currency, { compact: true }).replace(/\.00$/, '')}
                  labelFormat={(l) => `${fmtInt(Number(l))} answers / month`}
                  height={200}
                />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  suffix,
  step = 1,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  step?: number;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="number" min={0} step={step} value={value} onChange={(e) => onChange(e.target.value)} suffix={suffix} />
    </Field>
  );
}

function Result({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <p className="text-muted text-xs">{label}</p>
      <p className={`tabular text-base font-semibold ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : ''}`}>{value}</p>
      {sub && <p className="text-muted text-[11px]">{sub}</p>}
    </div>
  );
}
