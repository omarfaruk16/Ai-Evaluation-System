import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, Calculator, MoreHorizontal, Pencil, Plus, RotateCcw, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { DefinitionList, EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { del, errorMessage, patch } from '@/lib/api';
import { fmtInt, fmtMoney } from '@/lib/format';
import type { Plan } from '@/lib/types';
import { usePlans } from '../shared/queries';
import { PlanForm } from './PlanForm';

export default function PlansPage() {
  const q = usePlans();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Pricing plans"
        description="How you charge customers. Assign a plan to a project to bill it; monthly statements and invoices follow from the plan."
        actions={
          <>
            <Link to="/pricing/quote" className={buttonClass('outline')}>
              <Calculator /> Quote calculator
            </Link>
            <Button onClick={() => setEditing('new')}>
              <Plus /> New plan
            </Button>
          </>
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tags />}
            title="No pricing plans yet"
            description="Start with a per-answer plan in your local currency. Try numbers in the quote calculator first."
            action={
              <Button onClick={() => setEditing('new')}>
                <Plus /> New plan
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <PlanCard key={p.id} plan={p} onEdit={() => setEditing(p)} />
          ))}
        </div>
      )}
      {editing && <PlanForm open onOpenChange={(o) => !o && setEditing(null)} plan={editing === 'new' ? undefined : editing} />}
    </>
  );
}

function PlanCard({ plan: p, onEdit }: { plan: Plan; onEdit: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const archive = useMutation({
    mutationFn: (archived: boolean) => patch(`/plans/${p.id}`, { archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => del(`/plans/${p.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      toast.success('Plan deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const m = (v: number) => fmtMoney(v, p.currency);
  return (
    <Card className={p.archived ? 'opacity-60' : undefined}>
      <CardBody className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold">{p.name}</h3>
              {p.archived && <Badge>Archived</Badge>}
            </div>
            <p className="text-muted mt-0.5 text-xs">
              {p.billingModel === 'per_answer' ? 'Per answer' : 'AI cost + markup'} · {p.currency} · {fmtInt(p.clients ?? 0)} project{p.clients === 1 ? '' : 's'}
            </p>
          </div>
          <Menu
            trigger={
              <Button size="icon" variant="ghost" aria-label="Plan actions">
                <MoreHorizontal />
              </Button>
            }
          >
            <MenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </MenuItem>
            <MenuItem onSelect={() => archive.mutate(!p.archived)}>
              {p.archived ? <RotateCcw /> : <Archive />} {p.archived ? 'Restore' : 'Archive'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              danger
              disabled={(p.clients ?? 0) > 0}
              onSelect={async () => {
                if (await confirm({ title: `Delete ${p.name}?`, confirmLabel: 'Delete', danger: true })) remove.mutate();
              }}
            >
              <Trash2 /> Delete
            </MenuItem>
          </Menu>
        </div>
        <div className="tabular text-2xl font-semibold tracking-tight">
          {p.billingModel === 'per_answer' ? (
            p.includedAnswers > 0 ? (
              <>
                {m(p.monthlyFee)}
                <span className="text-muted text-sm font-normal"> / month</span>
              </>
            ) : (
              <>
                {m(p.pricePerAnswer)}
                <span className="text-muted text-sm font-normal"> / answer</span>
              </>
            )
          ) : (
            <>
              +{p.markupPercent}%<span className="text-muted text-sm font-normal"> on AI cost</span>
            </>
          )}
        </div>
        <DefinitionList
          className="text-[13px]"
          items={[
            ...(p.monthlyFee > 0 && !(p.billingModel === 'per_answer' && p.includedAnswers > 0) ? ([['Subscription', `${m(p.monthlyFee)} / month`]] as [string, string][]) : []),
            ...(p.billingModel === 'per_answer' && p.includedAnswers > 0
              ? ([
                  ['Included', `${fmtInt(p.includedAnswers)} answers`],
                  ['Extra answers', `${m(p.pricePerAnswer)} each`],
                ] as [string, string][])
              : []),
            ['Rubric drafts', p.pricePerRubricDraft > 0 ? `${m(p.pricePerRubricDraft)} each` : 'Included'],
            ['Reused / blank', `${p.chargeReused ? 'charged' : 'free'} / ${p.chargeBlank ? 'charged' : 'free'}`],
            ['Tax', p.taxPercent ? `${p.taxPercent}%` : 'None'],
          ]}
        />
      </CardBody>
    </Card>
  );
}
