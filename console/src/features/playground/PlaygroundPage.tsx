import { useMutation, useQuery } from '@tanstack/react-query';
import { FlaskConical, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/controls';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/page';
import { errorMessage, get, post } from '@/lib/api';
import { fmtNum, fmtUsd } from '@/lib/format';
import type { Criterion, DraftResponse, MarkResponse } from '@/lib/types';
import { CallStrip } from '../shared/CallStrip';
import { MarkingResultView } from '../shared/MarkingResultView';
import { useModels } from '../shared/queries';

interface Sample {
  question: string;
  modelAnswer: string;
  maxMarks: number;
  markStep: number;
  rubric: { criteria: Criterion[] };
  answer: string;
}

let nextId = 1;
const newCriterion = (n: number): Criterion & { key: number } => ({ key: nextId++, id: `c${n}`, criterion: '', marks: 1, awardWhen: '' });

export default function PlaygroundPage() {
  const models = useModels();
  const sample = useQuery({ queryKey: ['playground', 'sample'], queryFn: ({ signal }) => get<Sample>('/playground/sample', signal), staleTime: Infinity });
  const [profileId, setProfileId] = useState('');
  const [question, setQuestion] = useState('');
  const [modelAnswer, setModelAnswer] = useState('');
  const [maxMarks, setMaxMarks] = useState('6');
  const [markStep, setMarkStep] = useState('0.5');
  const [criteria, setCriteria] = useState<(Criterion & { key: number })[]>([newCriterion(1)]);
  const [answer, setAnswer] = useState('');

  const loadSample = () => {
    const s = sample.data;
    if (!s) return;
    setQuestion(s.question);
    setModelAnswer(s.modelAnswer);
    setMaxMarks(String(s.maxMarks));
    setMarkStep(String(s.markStep));
    setCriteria(s.rubric.criteria.map((c) => ({ ...c, key: nextId++ })));
    setAnswer(s.answer);
  };

  const total = criteria.reduce((s, c) => s + (Number(c.marks) || 0), 0);
  const rubricOk = criteria.length > 0 && criteria.every((c) => c.criterion.trim()) && Math.abs(total - Number(maxMarks)) < 1e-6;
  const renumber = (list: (Criterion & { key: number })[]) => list.map((c, i) => ({ ...c, id: `c${i + 1}` }));

  const mark = useMutation({
    mutationFn: () =>
      post<MarkResponse>('/playground/mark', {
        question,
        modelAnswer,
        maxMarks: Number(maxMarks),
        markStep: Number(markStep),
        rubric: { criteria: criteria.map(({ key: _k, ...c }) => ({ ...c, marks: Number(c.marks) })) },
        answer,
        ...(profileId ? { profileId } : {}),
      }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const draft = useMutation({
    mutationFn: () =>
      post<DraftResponse>('/playground/draft-rubric', {
        question,
        modelAnswer,
        maxMarks: Number(maxMarks),
        markStep: Number(markStep),
        ...(profileId ? { profileId } : {}),
      }),
    onSuccess: (r) => {
      if (r.ok) {
        setCriteria(r.rubric.criteria.map((c) => ({ ...c, key: nextId++ })));
        toast.success(`Rubric drafted in ${(r.latencyMs / 1000).toFixed(1)} s for ${fmtUsd(r.usage.costUsd)}`);
      } else toast.error(r.error);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const profiles = (models.data?.profiles ?? []).filter((p) => !p.archived);
  const markingId = models.data?.assignments.marking;
  const r = mark.data;

  return (
    <>
      <PageHeader
        title="Playground"
        description="Try a question, rubric and answer against any model profile before projects use it. Calls are real and their cost counts as playground spend."
        actions={
          <Button variant="outline" onClick={loadSample} disabled={!sample.data}>
            <Sparkles /> Load sample
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-4">
              <Field label="Model profile" htmlFor="pg-profile">
                <Select id="pg-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  <option value="">Use the task assignments (marking: {profiles.find((p) => p.id === markingId)?.name ?? '…'})</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Question" htmlFor="pg-q">
                <Textarea id="pg-q" value={question} onChange={(e) => setQuestion(e.target.value)} className="min-h-[64px]" />
              </Field>
              <Field label="Model answer" htmlFor="pg-ma">
                <Textarea id="pg-ma" value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Marks" htmlFor="pg-max">
                  <Input id="pg-max" type="number" min={0.5} step={0.5} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
                </Field>
                <Field label="Mark step" htmlFor="pg-step">
                  <Select id="pg-step" value={markStep} onChange={(e) => setMarkStep(e.target.value)}>
                    <option value="0.25">0.25</option>
                    <option value="0.5">0.5</option>
                    <option value="1">1</option>
                  </Select>
                </Field>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Rubric"
              description={
                <span className={rubricOk ? '' : 'text-warning'}>
                  Criteria add up to {fmtNum(total, 2)} of {maxMarks || '?'} marks
                </span>
              }
              actions={
                <Button size="sm" variant="outline" onClick={() => draft.mutate()} loading={draft.isPending} disabled={!question.trim() || !modelAnswer.trim() || !Number(maxMarks)}>
                  <Wand2 /> Draft with AI
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {criteria.map((c, i) => (
                <div key={c.key} className="grid grid-cols-[36px_1fr_76px_32px] items-start gap-2">
                  <span className="text-muted pt-2 font-mono text-xs">{c.id}</span>
                  <div className="grid gap-1.5">
                    <Input
                      value={c.criterion}
                      placeholder="What earns these marks"
                      onChange={(e) => setCriteria((list) => list.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))}
                      aria-label={`Criterion ${c.id}`}
                    />
                    <Input
                      value={c.awardWhen}
                      placeholder="Award when… (optional)"
                      className="h-8 text-[13px]"
                      onChange={(e) => setCriteria((list) => list.map((x, j) => (j === i ? { ...x, awardWhen: e.target.value } : x)))}
                      aria-label={`Award when for ${c.id}`}
                    />
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step={markStep}
                    value={c.marks}
                    onChange={(e) => setCriteria((list) => list.map((x, j) => (j === i ? { ...x, marks: e.target.value as unknown as number } : x)))}
                    aria-label={`Marks for ${c.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${c.id}`}
                    disabled={criteria.length === 1}
                    onClick={() => setCriteria((list) => renumber(list.filter((_, j) => j !== i)))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => setCriteria((list) => [...list, newCriterion(list.length + 1)])} disabled={criteria.length >= 12}>
                <Plus /> Add criterion
              </Button>
              {draft.data && draft.data.ok && draft.data.notes && <p className="text-muted text-xs">AI note: {draft.data.notes}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-3">
              <Field label="Student answer" htmlFor="pg-ans" hint="English, Bangla or mixed. Leave empty to see how blank answers are handled.">
                <Textarea id="pg-ans" value={answer} onChange={(e) => setAnswer(e.target.value)} className="min-h-[140px]" />
              </Field>
              <Button className="w-full" onClick={() => mark.mutate()} loading={mark.isPending} disabled={!question.trim() || !modelAnswer.trim() || !rubricOk}>
                <FlaskConical /> Mark this answer
              </Button>
            </CardBody>
          </Card>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader title="Result" description={r ? `${r.profile.name} · ${r.profile.model}` : 'The model’s suggestion appears here.'} />
            <CardBody>
              {mark.isPending ? (
                <div className="text-muted flex items-center gap-2 py-16 text-sm">
                  <Spinner /> Marking…
                </div>
              ) : !r ? (
                <EmptyState icon={<FlaskConical />} title="Nothing marked yet" description="Load the sample or write your own question, then press Mark." />
              ) : !r.ok ? (
                <div className="space-y-3">
                  <CallStrip r={r} />
                  <ErrorState error={new Error(r.error)} onRetry={() => mark.mutate()} />
                  {r.raw !== undefined && <pre className="bg-surface-2 max-h-72 overflow-auto rounded-md p-3 text-xs">{JSON.stringify(r.raw, null, 2)}</pre>}
                </div>
              ) : (
                <div className="space-y-5">
                  {r.note ? <p className="text-muted text-[13px]">{r.note}</p> : <CallStrip r={r} />}
                  <MarkingResultView result={r.result} answer={r.answer} maxMarks={r.maxMarks} />
                  {r.prompt && (
                    <details className="rounded-lg border px-4 py-2.5">
                      <summary className="text-muted cursor-pointer text-xs font-medium">Prompt sent to the model</summary>
                      <pre className="mt-2 max-h-80 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{`${r.prompt.system}\n\n---\n\n${r.prompt.user}`}</pre>
                    </details>
                  )}
                  {r.raw !== undefined && (
                    <details className="rounded-lg border px-4 py-2.5">
                      <summary className="text-muted cursor-pointer text-xs font-medium">Raw model output</summary>
                      <pre className="mt-2 max-h-80 overflow-auto font-mono text-[11.5px]">{JSON.stringify(r.raw, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
          {models.isError && <ErrorState error={models.error} />}
        </div>
      </div>
    </>
  );
}
