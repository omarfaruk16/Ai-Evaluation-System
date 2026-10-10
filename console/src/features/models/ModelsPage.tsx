import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FlaskConical, KeyRound, MoreHorizontal, Pencil, Plus, RotateCcw, ShieldAlert, Wallet } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { DefinitionList, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { errorMessage, get, post, put } from '@/lib/api';
import { fmtInt, fmtMs, fmtNum, fmtPct, fmtUsd } from '@/lib/format';
import { PROVIDER_LABEL, TASK_LABEL, type KeyInfo, type MarkResponse, type Profile, type Task } from '@/lib/types';
import { CallStrip } from '../shared/CallStrip';
import { MarkingResultView } from '../shared/MarkingResultView';
import { useModels } from '../shared/queries';
import { ProfileSheet } from './ProfileSheet';

const TASKS = Object.keys(TASK_LABEL) as Task[];

export default function ModelsPage() {
  const q = useModels();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [testing, setTesting] = useState<Profile | null>(null);
  const [keyFor, setKeyFor] = useState<Profile | null>(null);

  return (
    <>
      <PageHeader
        title="Models & providers"
        description="Choose which model marks answers, drafts rubrics and rewrites feedback. Changes reach every server process within 10 seconds — no restart."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New profile
          </Button>
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <Assignments data={q.data} />
            <Card>
              <CardHeader title="API keys" description="Keys live in the AI server’s environment (.env), never in the database." />
              <CardBody className="space-y-2.5">
                {q.data.keys.length === 0 ? (
                  <p className="text-muted text-[13px]">No profile needs a key yet.</p>
                ) : (
                  q.data.keys.map((k) => (
                    <div key={k.name} className="flex items-center justify-between gap-3">
                      <code className="font-mono text-[12.5px]">{k.name}</code>
                      {k.set ? <Badge tone="success">Set {k.hint}</Badge> : <Badge tone="danger">Missing</Badge>}
                    </div>
                  ))
                )}
                {q.data.keys.some((k) => !k.set) && (
                  <p className="text-muted border-t pt-2.5 text-xs leading-relaxed">
                    Add the variable to the server’s <code className="font-mono">.env</code> and restart the API and worker. Calls with a missing key fail
                    straight away and are logged.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {q.data.profiles.map((p) => (
              <ProfileCard key={p.id} p={p} onEdit={() => setEditing(p)} onTest={() => setTesting(p)} onKey={() => setKeyFor(p)} />
            ))}
          </div>
        </div>
      )}
      {editing && <ProfileSheet open onOpenChange={(o) => !o && setEditing(null)} profile={editing === 'new' ? undefined : editing} />}
      {testing && <TestDialog profile={testing} onClose={() => setTesting(null)} />}
      {keyFor && <KeyDialog profile={keyFor} onClose={() => setKeyFor(null)} />}
    </>
  );
}

function Assignments({ data }: { data: NonNullable<ReturnType<typeof useModels>['data']> }) {
  const qc = useQueryClient();
  const active = data.profiles.filter((p) => !p.archived);
  const [value, setValue] = useState<Record<Task, string>>(() => Object.fromEntries(TASKS.map((t) => [t, data.assignments[t] ?? ''])) as Record<Task, string>);
  useEffect(() => setValue(Object.fromEntries(TASKS.map((t) => [t, data.assignments[t] ?? ''])) as Record<Task, string>), [data.assignments]);
  const dirty = TASKS.some((t) => value[t] !== (data.assignments[t] ?? ''));
  const save = useMutation({
    mutationFn: () => put('/models/assignments', value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Assignments saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const mockInUse = TASKS.some((t) => active.find((p) => p.id === value[t])?.provider === 'mock');

  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Task assignments"
        description="Each task can use a different model — e.g. a stronger one for rubric drafts, which are few."
        actions={
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || TASKS.some((t) => !value[t])} loading={save.isPending}>
            Save assignments
          </Button>
        }
      />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        {TASKS.map((t) => (
          <Field key={t} label={TASK_LABEL[t]} htmlFor={`assign-${t}`}>
            <Select id={`assign-${t}`} value={value[t]} onChange={(e) => setValue((v) => ({ ...v, [t]: e.target.value }))}>
              {!value[t] && <option value="">Choose a profile</option>}
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        {mockInUse && (
          <p className="text-warning flex items-center gap-2 text-xs sm:col-span-3">
            <ShieldAlert className="size-3.5" />
            The mock marker scores by keyword overlap — fine for development, refused in production.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ProfileCard({ p, onEdit, onTest, onKey }: { p: Profile; onEdit: () => void; onTest: () => void; onKey: () => void }) {
  const qc = useQueryClient();
  const action = useMutation({
    mutationFn: (kind: 'duplicate' | 'archive' | 'restore') => post(`/models/${p.id}/${kind}`),
    onSuccess: (_d, kind) => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(kind === 'duplicate' ? 'Profile duplicated' : kind === 'archive' ? 'Profile archived' : 'Profile restored');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = p.last30d;
  const r = p.routing;

  return (
    <Card className={p.archived ? 'opacity-60' : undefined}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold">{p.name}</h3>
            <Badge tone={p.provider === 'mock' ? 'warning' : 'primary'}>{PROVIDER_LABEL[p.provider]}</Badge>
            {p.archived && <Badge>Archived</Badge>}
          </div>
          <p className="text-muted mt-1 truncate font-mono text-xs">{p.model}</p>
          {p.usedFor.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.usedFor.map((t) => (
                <Badge key={t} tone="success" dot>
                  {TASK_LABEL[t]}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={onTest} disabled={p.archived}>
            <FlaskConical /> Test
          </Button>
          <Menu
            trigger={
              <Button size="icon" variant="ghost" aria-label="Profile actions">
                <MoreHorizontal />
              </Button>
            }
          >
            <MenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </MenuItem>
            <MenuItem onSelect={() => action.mutate('duplicate')}>
              <Copy /> Duplicate
            </MenuItem>
            {p.provider === 'openrouter' && (
              <MenuItem onSelect={onKey}>
                <Wallet /> Key usage & credits
              </MenuItem>
            )}
            <MenuSeparator />
            {p.archived ? (
              <MenuItem onSelect={() => action.mutate('restore')}>
                <RotateCcw /> Restore
              </MenuItem>
            ) : (
              <MenuItem danger disabled={p.usedFor.length > 0} onSelect={() => action.mutate('archive')}>
                <Archive /> {p.usedFor.length > 0 ? 'Archive (in use)' : 'Archive'}
              </MenuItem>
            )}
          </Menu>
        </div>
      </div>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <PriceBox label="Input / 1M" value={p.prices.input} />
          <PriceBox label="Cached / 1M" value={p.prices.cachedInput || null} />
          <PriceBox label="Output / 1M" value={p.prices.output} />
        </div>
        <DefinitionList
          className="text-[13px]"
          items={[
            ...(r
              ? ([
                  ['Hosts', r.only.length ? r.only.join(', ') : 'Any host'],
                  ['Routing', [r.quantizations.length ? r.quantizations.join('/') : 'any quantization', r.zdr ? 'zero retention' : null, r.sort ? `prefer ${r.sort}` : null].filter(Boolean).join(' · ')],
                ] as [string, string][])
              : []),
            ...(p.provider === 'openai_compatible' ? ([['Endpoint', <span className="font-mono text-xs">{p.baseUrl}</span>]] as [string, ReactNode][]) : []),
            ['Settings', `temperature ${p.temperature}${p.seed !== null ? ` · seed ${p.seed}` : ''} · reasoning ${p.reasoning} · ${p.jsonMode === 'json_schema' ? 'strict JSON' : 'JSON mode'}`],
            ['Key', p.apiKeyEnv ? <code className="font-mono text-xs">{p.apiKeyEnv}</code> : 'Not needed'],
          ]}
        />
        <div className="bg-surface-2/70 grid grid-cols-2 gap-3 rounded-lg px-4 py-3 text-[13px] sm:grid-cols-4">
          <Mini label="Calls (30 d)" value={fmtInt(s.calls)} />
          <Mini label="Failed" value={s.calls ? fmtPct(s.failed / s.calls, 1) : '—'} warn={s.calls > 0 && s.failed / s.calls > 0.05} />
          <Mini label="Avg · p95 time" value={s.avgLatencyMs !== null ? `${fmtMs(s.avgLatencyMs)} · ${fmtMs(s.p95LatencyMs)}` : '—'} />
          <Mini label="Cost (30 d)" value={fmtUsd(s.costUsd)} />
        </div>
        {p.notes && <p className="text-muted text-xs whitespace-pre-line">{p.notes}</p>}
      </CardBody>
    </Card>
  );
}

function PriceBox({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-muted text-[11px]">{label}</p>
      <p className="tabular text-sm font-semibold">{value === null ? '—' : `$${fmtNum(value, 4)}`}</p>
    </div>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <p className="text-muted text-[11px]">{label}</p>
      <p className={`tabular font-medium ${warn ? 'text-danger' : ''}`}>{value}</p>
    </div>
  );
}

/** Marks the built-in sample answer with this profile. */
function TestDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const run = useMutation({ mutationFn: () => post<MarkResponse>(`/models/${profile.id}/test`) });
  useEffect(() => {
    run.mutate();
  }, []);
  const r = run.data;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="xl" title={`Test: ${profile.name}`} description="Marks a built-in sample answer (TCP reliability, 6 marks) through this profile. Counts as playground spend.">
      {run.isPending ? (
        <div className="text-muted flex items-center gap-2 py-10 text-sm">
          <Spinner /> Calling {profile.model}…
        </div>
      ) : run.isError ? (
        <ErrorState error={run.error} onRetry={() => run.mutate()} />
      ) : r && !r.ok ? (
        <div className="space-y-3">
          <ErrorState error={new Error(r.error)} onRetry={() => run.mutate()} />
          {r.raw !== undefined && <pre className="bg-surface-2 max-h-60 overflow-auto rounded-md p-3 text-xs">{JSON.stringify(r.raw, null, 2)}</pre>}
        </div>
      ) : r && r.ok ? (
        <div className="space-y-4">
          <CallStrip r={r} />
          <MarkingResultView result={r.result} answer={r.answer} maxMarks={r.maxMarks} />
        </div>
      ) : null}
    </Modal>
  );
}

function KeyDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const q = useQuery({ queryKey: ['models', profile.id, 'key'], queryFn: ({ signal }) => get<KeyInfo>(`/models/${profile.id}/key`, signal), retry: false });
  const k = q.data;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="OpenRouter key" description={`The key in ${profile.apiKeyEnv ?? 'the environment'}, as OpenRouter reports it. Free to check.`}>
      {q.isPending ? (
        <div className="text-muted flex items-center gap-2 py-6 text-sm">
          <Spinner /> Asking OpenRouter…
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !k?.configured ? (
        <div className="flex gap-3 text-sm">
          <KeyRound className="text-warning mt-0.5 size-4 shrink-0" />
          <p>
            <code className="font-mono">{k?.keyEnv}</code> is not set on the server. Add it to the AI server’s <code className="font-mono">.env</code> and restart
            the API and worker.
          </p>
        </div>
      ) : !k.valid ? (
        <p className="text-danger text-sm">{k.error}</p>
      ) : (
        <DefinitionList
          items={[
            ['Key label', k.label ?? '—'],
            ['Spent with this key', fmtUsd(k.usageUsd)],
            ['Key spending limit', k.limitUsd === null ? 'No limit' : fmtUsd(k.limitUsd)],
            ['Left under the limit', k.limitRemainingUsd === null ? '—' : fmtUsd(k.limitRemainingUsd)],
            ['Account credits', k.credits ? `${fmtUsd(k.credits.totalUsd)} bought · ${fmtUsd(k.credits.usedUsd)} used · ${fmtUsd((k.credits.totalUsd ?? 0) - (k.credits.usedUsd ?? 0))} left` : 'Not available for this key'],
            ['Tier', k.isFreeTier ? <Badge tone="warning">Free tier — paid models fail</Badge> : 'Paid'],
          ]}
        />
      )}
    </Modal>
  );
}
