import { useQueryClient } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { errorMessage, post } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import type { Me } from '@/lib/types';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      {/* Quiet backdrop: a soft accent glow over a faint grid. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_70%)]"
      />
      <div aria-hidden className="bg-primary/15 pointer-events-none absolute top-[-20%] left-1/2 size-[36rem] -translate-x-1/2 rounded-full blur-3xl" />
      <div className="stagger relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-2xl shadow-lg shadow-primary/25">
            <FileText className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">AI Marking Console</h1>
          <p className="text-muted mt-1 text-sm">Sign in to manage models, clients and billing.</p>
        </div>
        <form onSubmit={submit} className="bg-surface/90 space-y-4 rounded-2xl border p-5 shadow-xl backdrop-blur sm:p-6">
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
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="bg-danger-soft text-danger animate-fade-up rounded-md px-3 py-2 text-[13px]">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            <Lock />
            Sign in
          </Button>
        </form>
        <p className="text-muted mt-6 text-center text-xs leading-relaxed">
          No account yet? On the server run <code className="bg-surface-2 rounded px-1 py-0.5 font-mono">pnpm admin:create</code>.
        </p>
      </div>
    </div>
  );
}
