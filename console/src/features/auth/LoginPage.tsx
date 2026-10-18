import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, Gauge, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ProgressRing } from '@/components/ui/motion';
import { errorMessage, post } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import type { Me } from '@/lib/types';

const FEATURES = [
  { icon: <Sparkles />, text: 'Rubric-based marks for every written answer, with the reasons' },
  { icon: <Gauge />, text: 'Live costs, margins and invoices per customer project' },
  { icon: <ShieldCheck />, text: 'Teachers approve every mark — the AI only suggests' },
];

/** A small marked answer, as a teacher would see it: what the console is for, at a glance. */
function PreviewCard() {
  const rows = [
    { c: 'Sequence numbers + ACKs', got: 2, max: 2 },
    { c: 'Retransmission', got: 2, max: 2 },
    { c: 'Checksum', got: 1, max: 1 },
    { c: 'Flow control', got: 0, max: 1 },
  ];
  return (
    <div className="animate-fade-up rounded-3xl border border-white/40 bg-white/80 p-5 text-left text-zinc-900 shadow-2xl backdrop-blur-md [animation-delay:200ms]">
      <div className="flex items-center gap-4">
        <ProgressRing value={5 / 6} size={64} stroke={7}>
          <span className="text-base font-bold">5</span>
          <span className="text-[10px] text-zinc-500">of 6</span>
        </ProgressRing>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">TCP reliability · Q3</p>
          <p className="text-xs text-zinc-500">Marked in 0.8 s · confidence 0.96</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.c} className="text-xs">
            <div className="mb-1 flex justify-between gap-3">
              <span className="truncate">{r.c}</span>
              <span className="font-semibold tabular-nums">
                {r.got}/{r.max}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
              <div
                className="h-full origin-left rounded-full bg-emerald-500 [animation:grow_900ms_cubic-bezier(0.22,1,0.36,1)_both]"
                style={{ width: `${(r.got / r.max) * 100}%`, animationDelay: `${400 + i * 120}ms` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ admin: Me }>('/auth/login', { email, password });
      qc.setQueryData(ME_KEY, { id: res.admin.id, email: res.admin.email, name: res.admin.name });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0b7a63] via-[#0f8f74] to-[#19b38f] p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="absolute -right-20 bottom-0 size-[22rem] rounded-full bg-emerald-200/20 blur-3xl" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.12] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
            <Sparkles className="size-5" />
          </div>
          <div className="leading-tight">
            <p className="text-base font-bold">AI Marking</p>
            <p className="text-xs text-white/70">Operator console</p>
          </div>
        </div>

        <div className="relative my-auto max-w-md py-10">
          <h2 className="stagger text-[34px] leading-[1.15] font-bold tracking-tight text-balance">
            <span className="block">Mark written answers</span>
            <span className="block text-emerald-100">in seconds, not weekends.</span>
          </h2>
          <ul className="stagger mt-8 space-y-3.5">
            {FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-3 text-[15px] text-white/90">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/15 [&_svg]:size-4">{f.icon}</span>
                {f.text}
              </li>
            ))}
          </ul>
          <div className="mt-10 max-w-sm">
            <PreviewCard />
          </div>
        </div>
        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} AI Marking</p>
      </aside>

      {/* Sign-in */}
      <main className="relative flex items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        <div aria-hidden className="bg-accent/15 pointer-events-none absolute -top-40 left-1/2 size-[30rem] -translate-x-1/2 rounded-full blur-3xl lg:hidden" />
        <div className="stagger relative w-full max-w-[400px]">
          <div className="mb-8">
            <div className="from-accent to-primary mb-5 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-[0_10px_24px_-10px_var(--primary)] lg:hidden">
              <Sparkles className="size-5" />
            </div>
            <h1 className="text-[28px] font-bold tracking-tight">Welcome back</h1>
            <p className="text-muted mt-1.5 text-sm">Sign in to manage models, projects and billing.</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                required
                // On phones the keyboard would cover half the page before anything is seen.
                autoFocus={window.matchMedia('(pointer: fine)').matches}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <div className="relative">
                <Input
                  id="password"
                  type={shown ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShown((v) => !v)}
                  className="text-muted hover:text-foreground absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg"
                  aria-label={shown ? 'Hide password' : 'Show password'}
                >
                  {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            {error && (
              <p role="alert" className="bg-danger-soft text-danger animate-fade-up rounded-xl px-3.5 py-2.5 text-[13px] font-medium">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              {!busy && <Lock />}
              Sign in
            </Button>
          </form>
          <div className="text-muted mt-8 flex items-start gap-2.5 text-xs leading-relaxed">
            <CheckCircle2 className="text-accent mt-0.5 size-4 shrink-0" />
            <p>
              No account yet? On the server run <code className="bg-surface-3 rounded-md px-1.5 py-0.5 font-mono">admin:create</code>.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
