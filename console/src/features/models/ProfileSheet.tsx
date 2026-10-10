import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, Server } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented, Spinner, Switch } from '@/components/ui/controls';
import { Sheet } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Table, Td, TdNum, Th, THead, Tr } from '@/components/ui/table';
import { errorMessage, get, post, put } from '@/lib/api';
import { fmtInt, fmtNum, fmtPct } from '@/lib/format';
import type { OpenRouterHost, OpenRouterModel, Profile, Provider, Routing } from '@/lib/types';
import { cn } from '@/lib/utils';

interface FormState {
  name: string;
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  reasoning: Profile['reasoning'];
  temperature: string;
  seed: string;
  maxOutputTokens: string;
  timeoutSec: string;
  jsonMode: Profile['jsonMode'];
  prices: { input: string; cachedInput: string; output: string };
  routing: Routing;
  notes: string;
}

const DEFAULT_ROUTING: Routing = { only: [], quantizations: ['fp8'], zdr: true, allowFallbacks: true, sort: null };

function initial(p?: Profile): FormState {
  return {
    name: p?.name ?? '',
    provider: p?.provider ?? 'openrouter',
    model: p?.model ?? 'deepseek/deepseek-v4-flash-0731',
    baseUrl: p?.provider === 'openai_compatible' ? (p.baseUrl ?? '') : '',
    apiKeyEnv: p?.apiKeyEnv ?? 'OPENROUTER_API_KEY',
    reasoning: p?.reasoning ?? 'off',
    temperature: String(p?.temperature ?? 0),
    seed: p?.seed === null ? '' : String(p?.seed ?? 7),
    maxOutputTokens: String(p?.maxOutputTokens ?? 2000),
    timeoutSec: String((p?.timeoutMs ?? 60_000) / 1000),
    jsonMode: p?.jsonMode ?? 'json_schema',
    prices: {
      input: String(p?.prices.input ?? 0),
      cachedInput: String(p?.prices.cachedInput ?? 0),
      output: String(p?.prices.output ?? 0),
    },
    routing: p?.routing ?? DEFAULT_ROUTING,
    notes: p?.notes ?? '',
  };
}

const priceStr = (n: number | null) => (n === null ? '' : String(Number(n.toFixed(6))));

export function ProfileSheet({ open, onOpenChange, profile }: { open: boolean; onOpenChange: (o: boolean) => void; profile?: Profile }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState>(() => initial(profile));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const openrouter = f.provider === 'openrouter';

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name.trim(),
        provider: f.provider,
        model: f.provider === 'mock' ? 'mock/keyword-overlap' : f.model.trim(),
        baseUrl: f.provider === 'openai_compatible' ? f.baseUrl.trim() : null,
        apiKeyEnv: f.provider === 'mock' ? null : f.apiKeyEnv.trim(),
        routing: openrouter ? f.routing : null,
        reasoning: f.reasoning,
        temperature: Number(f.temperature),
        seed: f.seed.trim() === '' ? null : Number(f.seed),
        maxOutputTokens: Number(f.maxOutputTokens),
        timeoutMs: Math.round(Number(f.timeoutSec) * 1000),
        jsonMode: f.jsonMode,
        prices: { input: Number(f.prices.input), cachedInput: Number(f.prices.cachedInput), output: Number(f.prices.output) },
        notes: f.notes.trim() || null,
      };
      return profile ? put<Profile>(`/models/${profile.id}`, body) : post<Profile>('/models', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(profile ? 'Profile saved — in use within 10 seconds' : 'Profile created');
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width="max-w-4xl"
      title={profile ? `Edit ${profile.name}` : 'New model profile'}
      description="A profile is one way to call a model: provider, model id, routing, settings and prices."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name.trim()}>
            {profile ? 'Save profile' : 'Create profile'}
          </Button>
        </>
      }
    >
      <div className="space-y-7">
        <section className="space-y-4">
          <Field label="Provider">
            <Segmented
              value={f.provider}
              onChange={(v) => {
                setF((s) => ({
                  ...s,
                  provider: v,
                  apiKeyEnv: v === 'openrouter' ? 'OPENROUTER_API_KEY' : v === 'openai_compatible' && s.apiKeyEnv === 'OPENROUTER_API_KEY' ? '' : s.apiKeyEnv,
                }));
              }}
              options={[
                { value: 'openrouter', label: 'OpenRouter' },
                { value: 'openai_compatible', label: 'Other OpenAI-compatible API' },
                { value: 'mock', label: 'Mock (dev only)' },
              ]}
            />
          </Field>
          <Field label="Profile name" htmlFor="p-name" hint="Shown in task assignments and reports.">
            <Input id="p-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="DeepSeek V4 Flash — DeepInfra fp8" />
          </Field>
          {f.provider !== 'mock' && (
            <>
              {openrouter ? (
                <ModelSearch
                  value={f.model}
                  onChange={(model, m) => {
                    setF((s) => ({
                      ...s,
                      model,
                      ...(m
                        ? {
                            prices: {
                              input: priceStr(m.prices.input),
                              cachedInput: priceStr(m.prices.cachedInput ?? 0),
                              output: priceStr(m.prices.output),
                            },
                            name: s.name || m.name,
                          }
                        : {}),
                    }));
                  }}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Model id" htmlFor="p-model" hint="Exactly as the provider names it, e.g. deepseek-chat.">
                    <Input id="p-model" value={f.model} onChange={(e) => set('model', e.target.value)} />
                  </Field>
                  <Field label="API base URL" htmlFor="p-base" hint="Up to /v1 — the service adds /chat/completions.">
                    <Input id="p-base" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://api.deepseek.com/v1" />
                  </Field>
                </div>
              )}
              <Field
                label="API key variable"
                htmlFor="p-key"
                hint="The name of an environment variable on the AI server that holds the key (must end in _API_KEY). The key itself never goes in the database."
              >
                <Input id="p-key" value={f.apiKeyEnv} onChange={(e) => set('apiKeyEnv', e.target.value.toUpperCase())} className="font-mono" />
              </Field>
            </>
          )}
        </section>

        {openrouter && f.model && (
          <section className="space-y-3">
            <SectionTitle title="Hosts and routing" description="Which OpenRouter hosts may serve this model. Pinning hosts and a quantization keeps every student marked by the same model build." />
            <HostPicker model={f.model} routing={f.routing} onChange={(r) => set('routing', r)} onUsePrices={(p) => set('prices', p)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Switch checked={f.routing.zdr} onChange={(v) => set('routing', { ...f.routing, zdr: v })} label="Zero data retention" description="Only hosts that don’t store prompts. Recommended for student answers." />
              <Switch
                checked={f.routing.allowFallbacks}
                onChange={(v) => set('routing', { ...f.routing, allowFallbacks: v })}
                label="Fall back between pinned hosts"
                description="If one pinned host is down, try the next one."
              />
              <Field label="Quantizations" htmlFor="p-quant" hint="Comma separated, e.g. fp8. Empty = any.">
                <Input
                  id="p-quant"
                  value={f.routing.quantizations.join(', ')}
                  onChange={(e) =>
                    set('routing', {
                      ...f.routing,
                      quantizations: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Prefer hosts by" htmlFor="p-sort">
                <Select
                  id="p-sort"
                  value={f.routing.sort ?? ''}
                  onChange={(e) => set('routing', { ...f.routing, sort: (e.target.value || null) as Routing['sort'] })}
                >
                  <option value="">OpenRouter default (balanced)</option>
                  <option value="price">Lowest price</option>
                  <option value="throughput">Highest throughput</option>
                  <option value="latency">Lowest latency</option>
                </Select>
              </Field>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionTitle
            title="Prices (USD per 1M tokens)"
            description={
              openrouter
                ? 'OpenRouter reports the real cost of each call; these prices are used for estimates and the quote calculator.'
                : 'Used to work out the cost of each call, because this provider doesn’t report it.'
            }
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Input" htmlFor="p-in">
              <Input id="p-in" type="number" min={0} step="0.001" prefix="$" value={f.prices.input} onChange={(e) => set('prices', { ...f.prices, input: e.target.value })} />
            </Field>
            <Field label="Cached input" htmlFor="p-cin" hint="0 = no cache discount">
              <Input id="p-cin" type="number" min={0} step="0.001" prefix="$" value={f.prices.cachedInput} onChange={(e) => set('prices', { ...f.prices, cachedInput: e.target.value })} />
            </Field>
            <Field label="Output" htmlFor="p-out">
              <Input id="p-out" type="number" min={0} step="0.001" prefix="$" value={f.prices.output} onChange={(e) => set('prices', { ...f.prices, output: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle title="Generation settings" description="Temperature 0 and a fixed seed keep marks repeatable. Reasoning makes calls slower and dearer." />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Reasoning" htmlFor="p-reason">
              <Select id="p-reason" value={f.reasoning} onChange={(e) => set('reasoning', e.target.value as FormState['reasoning'])}>
                <option value="off">Off</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </Field>
            <Field label="Temperature" htmlFor="p-temp">
              <Input id="p-temp" type="number" min={0} max={2} step="0.1" value={f.temperature} onChange={(e) => set('temperature', e.target.value)} />
            </Field>
            <Field label="Seed" htmlFor="p-seed" hint="Empty = none">
              <Input id="p-seed" type="number" min={0} value={f.seed} onChange={(e) => set('seed', e.target.value)} />
            </Field>
            <Field label="Max output tokens" htmlFor="p-max">
              <Input id="p-max" type="number" min={200} step={100} value={f.maxOutputTokens} onChange={(e) => set('maxOutputTokens', e.target.value)} />
            </Field>
            <Field label="Timeout" htmlFor="p-timeout">
              <Input id="p-timeout" type="number" min={5} max={300} value={f.timeoutSec} onChange={(e) => set('timeoutSec', e.target.value)} suffix="seconds" />
            </Field>
            <Field label="Output format" htmlFor="p-json" hint={f.jsonMode === 'json_object' ? 'For APIs without strict schemas (e.g. DeepSeek’s own API).' : undefined}>
              <Select id="p-json" value={f.jsonMode} onChange={(e) => set('jsonMode', e.target.value as FormState['jsonMode'])}>
                <option value="json_schema">Strict JSON schema</option>
                <option value="json_object">JSON mode + schema in prompt</option>
              </Select>
            </Field>
          </div>
          <Field label="Notes" htmlFor="p-notes">
            <Textarea id="p-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} className="min-h-[60px]" />
          </Field>
        </section>
      </div>
    </Sheet>
  );
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="text-muted mt-0.5 text-[13px] leading-relaxed">{description}</p>}
    </div>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Model id field with OpenRouter catalogue search; picking a model fills its list prices. */
function ModelSearch({ value, onChange }: { value: string; onChange: (id: string, model?: OpenRouterModel) => void }) {
  const [focused, setFocused] = useState(false);
  const term = useDebounced(value, 250);
  const results = useQuery({
    queryKey: ['openrouter', 'models', term],
    queryFn: ({ signal }) => get<{ models: OpenRouterModel[]; total: number }>(`/models/openrouter/models?q=${encodeURIComponent(term)}`, signal),
    enabled: focused && term.trim().length >= 2,
    staleTime: 5 * 60_000,
  });
  return (
    <Field label="Model" htmlFor="p-model" hint="Search OpenRouter’s catalogue, or type an exact model id.">
      <div className="relative">
        <Input
          id="p-model"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          className="font-mono"
          prefix={<Search className="size-3.5" />}
          autoComplete="off"
        />
        {focused && term.trim().length >= 2 && (
          <div className="bg-surface absolute top-full right-0 left-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border shadow-xl">
            {results.isFetching && !results.data ? (
              <div className="text-muted flex items-center gap-2 px-3 py-3 text-[13px]">
                <Spinner /> Searching OpenRouter…
              </div>
            ) : results.isError ? (
              <p className="text-danger px-3 py-3 text-[13px]">{errorMessage(results.error)}</p>
            ) : results.data?.models.length === 0 ? (
              <p className="text-muted px-3 py-3 text-[13px]">No models match “{term}”.</p>
            ) : (
              results.data?.models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(m.id, m);
                    setFocused(false);
                  }}
                  className="hover:bg-surface-2 flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{m.name}</span>
                    <span className="text-muted block truncate font-mono text-xs">{m.id}</span>
                  </span>
                  <span className="tabular text-muted shrink-0 text-right text-xs">
                    ${fmtNum(m.prices.input, 3)} in · ${fmtNum(m.prices.output, 3)} out
                    {!m.supportsStructuredOutput && <span className="text-warning block">no strict JSON</span>}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

/** Live list of OpenRouter hosts for the model; tick hosts to pin them. */
function HostPicker({
  model,
  routing,
  onChange,
  onUsePrices,
}: {
  model: string;
  routing: Routing;
  onChange: (r: Routing) => void;
  onUsePrices: (p: FormState['prices']) => void;
}) {
  const valid = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(model);
  const hosts = useQuery({
    queryKey: ['openrouter', 'hosts', model],
    queryFn: ({ signal }) => get<{ name: string | null; hosts: OpenRouterHost[] }>(`/models/openrouter/hosts?model=${encodeURIComponent(model)}`, signal),
    enabled: valid,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const quant = routing.quantizations;
  const pinned = new Set(routing.only);
  const visible = useMemo(() => hosts.data?.hosts ?? [], [hosts.data]);
  const toggle = (slug: string) =>
    onChange({ ...routing, only: pinned.has(slug) ? routing.only.filter((s) => s !== slug) : [...routing.only, slug] });

  // Conservative estimate: the dearest of the hosts a request may land on.
  const usePinnedPrices = () => {
    const pool = visible.filter((h) => (pinned.size ? pinned.has(h.slug) : true) && (!quant.length || (h.quantization && quant.includes(h.quantization))));
    if (!pool.length) return toast.error('No host matches the pinned hosts and quantization');
    const max = (k: 'input' | 'cachedInput' | 'output') => Math.max(...pool.map((h) => h.prices[k] ?? 0));
    onUsePrices({ input: priceStr(max('input')), cachedInput: priceStr(max('cachedInput')), output: priceStr(max('output')) });
    toast.success(`Prices set from ${pool.length} host${pool.length > 1 ? 's' : ''} (highest of each)`);
  };

  if (!valid) return <p className="text-muted text-[13px]">Enter a model id like author/model-name to see its hosts.</p>;
  if (hosts.isPending)
    return (
      <div className="text-muted flex items-center gap-2 text-[13px]">
        <Spinner /> Loading hosts from OpenRouter…
      </div>
    );
  if (hosts.isError) return <p className="text-danger text-[13px]">{errorMessage(hosts.error)}</p>;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-surface-2/60 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <p className="text-[13px]">
          <Server className="text-muted mr-1.5 inline size-3.5" />
          {visible.length} hosts serve <span className="font-medium">{hosts.data.name ?? model}</span>
          {pinned.size > 0 ? ` · ${pinned.size} pinned` : ' · none pinned (any host)'}
        </p>
        <div className="flex gap-2">
          {pinned.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...routing, only: [] })}>
              Clear
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={usePinnedPrices}>
            Use these prices
          </Button>
        </div>
      </div>
      <Table>
        <THead>
          <tr>
            <Th className="w-8" />
            <Th>Host</Th>
            <Th>Quant.</Th>
            <Th className="text-right">In / 1M</Th>
            <Th className="text-right">Cached</Th>
            <Th className="text-right">Out / 1M</Th>
            <Th className="text-right">Context</Th>
            <Th className="text-right">Uptime 30m</Th>
          </tr>
        </THead>
        <tbody>
          {visible.map((h, i) => {
            const on = pinned.has(h.slug);
            const quantOk = !quant.length || (h.quantization !== null && quant.includes(h.quantization));
            return (
              <Tr key={`${h.slug}-${h.tag}-${i}`} onClick={() => toggle(h.slug)} className={cn(on && 'bg-primary-soft/60', !quantOk && 'opacity-55')}>
                <Td>
                  <span className={cn('flex size-4 items-center justify-center rounded border', on ? 'bg-primary border-primary text-primary-foreground' : 'border-input')}>
                    {on && <Check className="size-3" />}
                  </span>
                </Td>
                <Td>
                  <span className="font-medium">{h.name}</span>
                  <span className="text-muted ml-1.5 font-mono text-xs">{h.slug}</span>
                  {!h.supportsStructuredOutput && (
                    <Badge tone="warning" className="ml-2">
                      no strict JSON
                    </Badge>
                  )}
                </Td>
                <Td className="font-mono text-xs">{h.quantization ?? '—'}</Td>
                <TdNum>${fmtNum(h.prices.input, 4)}</TdNum>
                <TdNum className="text-muted">{h.prices.cachedInput !== null ? `$${fmtNum(h.prices.cachedInput, 4)}` : '—'}</TdNum>
                <TdNum>${fmtNum(h.prices.output, 4)}</TdNum>
                <TdNum className="text-muted">{h.contextLength ? `${fmtInt(h.contextLength / 1000)}k` : '—'}</TdNum>
                <TdNum className={h.uptime30m !== null && h.uptime30m < 95 ? 'text-warning' : 'text-muted'}>
                  {h.uptime30m !== null ? fmtPct(h.uptime30m / 100, 1) : '—'}
                </TdNum>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {!quant.length || visible.some((h) => h.quantization && quant.includes(h.quantization)) ? null : (
        <p className="text-warning border-t px-4 py-2 text-xs">No host offers {quant.join(', ')} — requests would fail. Change the quantization filter.</p>
      )}
    </div>
  );
}
