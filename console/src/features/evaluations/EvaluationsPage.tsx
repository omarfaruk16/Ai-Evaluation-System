import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Sheet } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { DefinitionList, EmptyState, ErrorState, PageHeader, PageSkeleton, Pagination } from '@/components/ui/page';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { errorMessage, get, post } from '@/lib/api';
import { fmtDate, fmtInt, fmtMs, fmtNum, fmtRelative, fmtUsd } from '@/lib/format';
import { TASK_LABEL, type Client, type EvaluationDetail, type EvaluationRow, type Paged } from '@/lib/types';
import { MarkingResultView } from '../shared/MarkingResultView';

const FILTERS = ['clientId', 'status', 'lane', 'decision', 'flag', 'q'] as const;

export default function EvaluationsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const page = Number(params.get('page') ?? 1);
  const selected = params.get('id');
  const clients = useQuery({ queryKey: ['clients'], queryFn: ({ signal }) => get<Client[]>('/clients', signal) });

  const query = new URLSearchParams();
  for (const k of FILTERS) {
    const v = params.get(k);
    if (v) query.set(k, v);
  }
  query.set('page', String(page));
  query.set('pageSize', '50');

  const q = useQuery({
    queryKey: ['evaluations', query.toString()],
    queryFn: ({ signal }) => get<Paged<EvaluationRow>>(`/evaluations?${query}`, signal),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) setFilter('q', search.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Evaluations" description="Every answer sent for marking, newest first. Open one to see the model’s reasoning, the calls it took and what they cost." />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full sm:w-64">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Answer, group or evaluation id" prefix={<Search className="size-3.5" />} />
        </div>
        <Select className="w-44" value={params.get('clientId') ?? ''} onChange={(e) => setFilter('clientId', e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {clients.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select className="w-36" value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </Select>
        <Select className="w-40" value={params.get('decision') ?? ''} onChange={(e) => setFilter('decision', e.target.value)} aria-label="Teacher decision">
          <option value="">Any review</option>
          <option value="none">Not reviewed</option>
          <option value="accepted">Accepted</option>
          <option value="adjusted">Adjusted</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Select className="w-36" value={params.get('lane') ?? ''} onChange={(e) => setFilter('lane', e.target.value)} aria-label="Lane">
          <option value="">Any lane</option>
          <option value="realtime">Realtime</option>
          <option value="deferred">Deferred</option>
        </Select>
        <Select className="w-44" value={params.get('flag') ?? ''} onChange={(e) => setFilter('flag', e.target.value)} aria-label="Flag">
          <option value="">Any flag</option>
          <option value="blank">Blank</option>
          <option value="off_topic">Off topic</option>
          <option value="injection_attempt">Injection attempt</option>
          <option value="language_mismatch">Language mismatch</option>
          <option value="incomplete_output">Incomplete output</option>
          <option value="too_long">Too long</option>
        </Select>
      </div>

      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <Card>
          <EmptyState icon={<ListChecks />} title="No evaluations match" description="Change the filters, or wait for a project to send answers." />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Received</Th>
                <Th>Project · answer</Th>
                <Th>Status</Th>
                <Th className="text-right">AI mark</Th>
                <Th className="text-right">Final</Th>
                <Th>Review</Th>
                <Th className="text-right">Confidence</Th>
              </tr>
            </THead>
            <tbody>
              {q.data.items.map((e) => (
                <Tr key={e.id} onClick={() => open(e.id)}>
                  <Td className="text-muted text-xs whitespace-nowrap">{fmtRelative(e.createdAt)}</Td>
                  <Td className="max-w-[340px]">
                    <p className="truncate text-[13px]">
                      <span className="font-medium">{e.client.name}</span>
                      <span className="text-muted"> · {e.externalId}</span>
                    </p>
                    <p className="text-muted truncate text-xs">{e.question}</p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={e.status} />
                      {e.reusedFromId && <Badge>reused</Badge>}
                      {e.flags.filter((f) => f !== 'blank').length > 0 && <Badge tone="warning">{e.flags.filter((f) => f !== 'blank').length} flag</Badge>}
                      {e.flags.includes('blank') && <Badge>blank</Badge>}
                    </div>
                  </Td>
                  <TdNum>{e.suggestedScore === null ? '—' : `${fmtNum(e.suggestedScore, 1)} / ${fmtNum(e.maxMarks, 1)}`}</TdNum>
                  <TdNum>{e.finalScore === null ? '—' : fmtNum(e.finalScore, 1)}</TdNum>
                  <Td>{e.decision ? <StatusBadge status={e.decision} /> : <span className="text-muted text-xs">—</span>}</Td>
                  <TdNum className="text-muted">{e.confidence === null ? '—' : e.confidence.toFixed(2)}</TdNum>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={q.data.page}
            pages={q.data.pages}
            total={q.data.total}
            onPage={(p) => {
              const next = new URLSearchParams(params);
              next.set('page', String(p));
              setParams(next, { replace: true });
            }}
          />
        </Card>
      )}
      {selected && <EvaluationSheet id={selected} onClose={() => open(null)} />}
    </>
  );
}

function EvaluationSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['evaluations', 'detail', id], queryFn: ({ signal }) => get<EvaluationDetail>(`/evaluations/${id}`, signal) });
  const rerun = useMutation({
    mutationFn: () => post(`/evaluations/${id}/rerun`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evaluations'] });
      toast.success('Queued for marking again');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  const ev = d?.evaluation;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      width="max-w-3xl"
      title={ev ? `${d.client.name} · ${ev.externalId}` : 'Evaluation'}
      description={ev ? `Received ${fmtDate(ev.createdAt, true)}${ev.completedAt ? ` · finished ${fmtDate(ev.completedAt, true)}` : ''}` : undefined}
      footer={
        ev && (
          <Button
            variant="outline"
            disabled={ev.status === 'queued' || ev.status === 'running'}
            loading={rerun.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: 'Mark this answer again?',
                  description: 'The current result and any teacher review are cleared, and the project is notified when the new result is ready. It costs one more model call.',
                  confirmLabel: 'Re-run',
                })
              )
                rerun.mutate();
            }}
          >
            <RotateCcw /> Re-run
          </Button>
        )
      }
    >
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        ev &&
        d && (
          <div className="space-y-7">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={ev.status} />
              <Badge>{ev.lane}</Badge>
              {ev.reusedFromId && <Badge tone="info">Reused an identical answer</Badge>}
              {ev.review && <StatusBadge status={ev.review.decision} label={`teacher ${ev.review.decision}`} />}
            </div>
            {ev.error && <p className="bg-danger-soft text-danger rounded-lg px-4 py-3 text-[13px]">{ev.error}</p>}

            {ev.status === 'completed' && (
              <MarkingResultView
                result={{
                  suggestedScore: ev.suggestedScore ?? 0,
                  criteria: ev.criteria,
                  summary: ev.summary,
                  strengths: ev.strengths,
                  weaknesses: ev.weaknesses,
                  highlights: ev.highlights,
                  missing: ev.missing,
                  studentFeedback: ev.studentFeedback,
                  confidence: ev.confidence,
                  flags: ev.flags,
                }}
                answer={ev.answerText}
                maxMarks={ev.maxMarks}
              />
            )}

            {ev.review && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Teacher review</h3>
                <DefinitionList
                  className="text-[13px]"
                  items={[
                    ['Decision', ev.review.decision],
                    ['Final mark', ev.review.finalScore === null ? '—' : `${fmtNum(ev.review.finalScore, 1)} / ${fmtNum(ev.maxMarks, 1)} (AI suggested ${fmtNum(ev.suggestedScore, 1)})`],
                    ['Reviewed', fmtDate(ev.review.reviewedAt, true)],
                    ...(ev.review.finalCriteria
                      ? ([['Per criterion', ev.review.finalCriteria.map((c) => `${c.id} ${fmtNum(c.awarded, 1)}/${fmtNum(c.max, 1)}`).join(' · ')]] as [string, string][])
                      : []),
                  ]}
                />
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Question</h3>
              <p className="text-[13.5px] leading-relaxed">{d.question.text}</p>
              <details className="rounded-lg border px-4 py-2.5 text-[13px]">
                <summary className="text-muted cursor-pointer text-xs font-medium">Model answer and rubric</summary>
                <p className="mt-2 leading-relaxed whitespace-pre-line">{d.question.modelAnswer}</p>
                <ul className="mt-3 space-y-1">
                  {d.question.rubric.criteria.map((c) => (
                    <li key={c.id}>
                      <span className="text-muted font-mono text-xs">{c.id}</span> {c.criterion} — <span className="tabular">{fmtNum(c.marks, 1)}</span> marks
                      {c.awardWhen && <span className="text-muted"> · {c.awardWhen}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            </section>

            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Model calls</h3>
                <span className="text-muted text-xs">Total {fmtUsd(d.costUsd)}</span>
              </div>
              {d.calls.length === 0 ? (
                <p className="text-muted text-[13px]">{ev.reusedFromId ? 'None — the result was reused.' : 'None.'}</p>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <THead>
                      <tr>
                        <Th>Task</Th>
                        <Th>Model · host</Th>
                        <Th className="text-right">Tokens</Th>
                        <Th className="text-right">Time</Th>
                        <Th className="text-right">Cost</Th>
                      </tr>
                    </THead>
                    <tbody>
                      {d.calls.map((c) => (
                        <Tr key={c.id}>
                          <Td>
                            {TASK_LABEL[c.kind]}
                            {!c.ok && <span className="text-danger block max-w-[180px] truncate text-xs" title={c.error ?? ''}>{c.error}</span>}
                          </Td>
                          <Td className="max-w-[200px]">
                            <span className="block truncate font-mono text-xs">{c.model}</span>
                            <span className="text-muted text-xs">{c.host ?? '—'}</span>
                          </Td>
                          <TdNum className="text-xs">
                            {fmtInt(c.inputTokens)} / {fmtInt(c.outputTokens)}
                          </TdNum>
                          <TdNum className="text-xs">{fmtMs(c.latencyMs)}</TdNum>
                          <TdNum className="text-xs">
                            {fmtUsd(c.costUsd)}
                            {c.costEstimated && <span className="text-muted block">estimated</span>}
                          </TdNum>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </section>

            {d.webhooks.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Webhooks</h3>
                <ul className="space-y-1.5 text-[13px]">
                  {d.webhooks.map((w) => (
                    <li key={w.id} className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={w.status} />
                      <span className="font-mono text-xs">{w.event}</span>
                      <span className="text-muted text-xs">
                        {w.attempts} attempt{w.attempts === 1 ? '' : 's'} · {w.lastError ?? (w.lastStatusCode ? `HTTP ${w.lastStatusCode}` : '')} · {fmtRelative(w.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-muted font-mono text-[11px]">
              {ev.id} · prompt {ev.promptVersion ?? '—'}
            </p>
          </div>
        )
      )}
    </Sheet>
  );
}
