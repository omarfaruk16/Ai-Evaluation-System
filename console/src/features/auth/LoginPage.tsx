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
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="bg-primary text-primary-foreground mb-4 flex size-11 items-center justify-center rounded-xl shadow-card">
            <FileText className="size-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">AI Marking Console</h1>
          <p className="text-muted mt-1 text-sm">Sign in to manage models, clients and billing.</p>
        </div>
        <form onSubmit={submit} className="bg-surface space-y-4 rounded-xl border p-6 shadow-card">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
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
            <p role="alert" className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={busy}>
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
