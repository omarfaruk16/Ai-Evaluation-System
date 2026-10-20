import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Mail, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm';
import { Segmented, Switch } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/ui/page';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { del, errorMessage, get, patch, post, put } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtRelative } from '@/lib/format';
import type { Admin, BillingSettings, Session } from '@/lib/types';
import { useBillingSettings } from '../shared/queries';

type Tab = 'business' | 'currency' | 'email' | 'admins' | 'account';

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'business';
  return (
    <>
      <PageHeader title="Settings" description="Your business details for invoices, currencies, and who can sign in to this console." />
      <Segmented
        className="mb-6"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        options={[
          { value: 'business', label: 'Business & invoices' },
          { value: 'currency', label: 'Currencies & time zone' },
          { value: 'email', label: 'Email alerts' },
          { value: 'admins', label: 'Admins' },
          { value: 'account', label: 'My account' },
        ]}
      />
      {tab === 'business' && <BillingForm section="business" />}
      {tab === 'currency' && <BillingForm section="currency" />}
      {tab === 'email' && <EmailAlerts />}
      {tab === 'admins' && <Admins />}
      {tab === 'account' && <Account />}
    </>
  );
}

function BillingForm({ section }: { section: 'business' | 'currency' }) {
  const qc = useQueryClient();
  const q = useBillingSettings();
  const [f, setF] = useState<BillingSettings | null>(null);
  const [rates, setRates] = useState<{ code: string; rate: string }[]>([]);
  const load = (d: BillingSettings) => {
    setF(d);
    setRates(Object.entries(d.fxRates).map(([code, rate]) => ({ code, rate: String(rate) })));
  };
  // Fill the form once. A background refetch (e.g. switching back to this tab or app) must not
  // overwrite what is being typed; after a save the form shows what was saved.
  useEffect(() => {
    if (q.data && f === null) load(q.data);
  }, [q.data, f]);
  const save = useMutation({
    mutationFn: (body: BillingSettings) => put<BillingSettings>('/billing/settings', body),
    onSuccess: (s) => {
      load(s);
      qc.setQueryData(['billing', 'settings'], s);
      qc.invalidateQueries({ queryKey: ['billing'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending || !f) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const set = <K extends keyof BillingSettings>(k: K, v: BillingSettings[K]) => setF({ ...f, [k]: v });
  const submit = () => {
    const fxRates = Object.fromEntries(rates.filter((r) => r.code.trim()).map((r) => [r.code.trim().toUpperCase(), Number(r.rate)]));
    save.mutate({ ...f, fxRates });
  };

  if (section === 'business') {
    return (
      <Card className="max-w-3xl">
        <CardHeader title="Business details" description="Printed on new invoices. Invoices already created keep the details they were made with." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" htmlFor="s-name" className="sm:col-span-2">
            <Input id="s-name" value={f.businessName} onChange={(e) => set('businessName', e.target.value)} />
          </Field>
          <Field label="Address" htmlFor="s-addr" className="sm:col-span-2">
            <Textarea id="s-addr" value={f.businessAddress} onChange={(e) => set('businessAddress', e.target.value)} className="min-h-[64px]" />
          </Field>
          <Field label="Email" htmlFor="s-email">
            <Input id="s-email" value={f.businessEmail} onChange={(e) => set('businessEmail', e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="s-phone">
            <Input id="s-phone" value={f.businessPhone} onChange={(e) => set('businessPhone', e.target.value)} />
          </Field>
          <Field label="How to pay" htmlFor="s-pay" className="sm:col-span-2" hint="Bank account, bKash/Nagad merchant number, etc.">
            <Textarea id="s-pay" value={f.paymentDetails} onChange={(e) => set('paymentDetails', e.target.value)} />
          </Field>
          <Field label="Invoice number prefix" htmlFor="s-prefix" hint={`Next numbers look like ${f.invoicePrefix}${new Date().getFullYear()}-0001`}>
            <Input id="s-prefix" value={f.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} />
          </Field>
          <Field label="Payment terms" htmlFor="s-terms" hint="Due date = issue date + this many days.">
            <Input id="s-terms" type="number" min={0} max={365} value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', Number(e.target.value))} suffix="days" />
          </Field>
          <Field label="Invoice footer" htmlFor="s-footer" className="sm:col-span-2">
            <Input id="s-footer" value={f.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} placeholder="Thank you for your business." />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button onClick={submit} loading={save.isPending}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [f.timeZone];
  return (
    <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Exchange rates" description="Units of each currency per 1 US dollar. AI costs are in USD and converted with these. Keep them current; invoices store the rate they used." />
        <CardBody className="space-y-3">
          {rates.map((r, i) => (
            <div key={i} className="grid grid-cols-[90px_1fr_32px] items-center gap-2">
              <Input
                value={r.code}
                maxLength={3}
                disabled={r.code === 'USD'}
                onChange={(e) => setRates((list) => list.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))}
                aria-label="Currency code"
                className="font-mono"
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                value={r.rate}
                disabled={r.code === 'USD'}
                onChange={(e) => setRates((list) => list.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))}
                aria-label={`${r.code} per USD`}
                prefix="="
              />
              <Button size="icon" variant="ghost" disabled={r.code === 'USD'} aria-label="Remove" onClick={() => setRates((list) => list.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setRates((list) => [...list, { code: '', rate: '' }])}>
            <Plus /> Add currency
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Defaults" />
        <CardBody className="space-y-4">
          <Field label="Default currency for new plans" htmlFor="s-cur">
            <Select id="s-cur" value={f.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value)}>
              {rates.filter((r) => r.code).map((r) => (
                <option key={r.code}>{r.code}</option>
              ))}
            </Select>
          </Field>
          <Field label="Business time zone" htmlFor="s-tz" hint="Billing months and daily charts start at midnight here.">
            <Select id="s-tz" value={f.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end">
            <Button onClick={submit} loading={save.isPending}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Admins() {
  const qc = useQueryClient();
  const me = useMe();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admins'], queryFn: ({ signal }) => get<Admin[]>('/admins', signal) });
  const [adding, setAdding] = useState(false);
  const toggle = useMutation({
    mutationFn: (a: Admin) => patch<Admin>(`/admins/${a.id}`, { active: !a.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card className="max-w-4xl">
      <CardHeader
        title="Console admins"
        description="Everyone here has full access, including billing and API keys. Keep the list short."
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <UserPlus /> Add admin
          </Button>
        }
      />
      <Table>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Status</Th>
            <Th>Last sign-in</Th>
            <Th />
          </tr>
        </THead>
        <tbody>
          {q.data.map((a) => (
            <Tr key={a.id}>
              <Td>
                <p className="font-medium">
                  {a.name} {a.id === me.data?.id && <Badge className="ml-1">You</Badge>}
                </p>
                <p className="text-muted text-xs">{a.email}</p>
              </Td>
              <Td>
                <StatusBadge status={a.active ? 'active' : 'disabled'} />
              </Td>
              <Td className="text-muted text-[13px]">{a.lastLoginAt ? fmtRelative(a.lastLoginAt) : 'Never'}</Td>
              <Td className="text-right">
                {a.id !== me.data?.id && (
                  <Button
                    size="sm"
                    variant={a.active ? 'danger-outline' : 'outline'}
                    onClick={async () => {
                      if (!a.active || (await confirm({ title: `Deactivate ${a.name}?`, description: 'They are signed out everywhere and can’t sign in again until reactivated.', confirmLabel: 'Deactivate', danger: true })))
                        toggle.mutate(a);
                    }}
                  >
                    {a.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {adding && <AddAdmin onClose={() => setAdding(false)} />}
    </Card>
  );
}

function AddAdmin({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const create = useMutation({
    mutationFn: () => post<Admin>('/admins', f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admins'] });
      toast.success('Admin added — share the password with them privately');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      dismissible={false}
      title="Add admin"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!f.name || !f.email || !f.password}>
            Add admin
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="a-name">
          <Input id="a-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Email" htmlFor="a-email">
          <Input id="a-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Temporary password" htmlFor="a-pw" hint="At least 10 characters with letters and digits. Ask them to change it after signing in.">
          <Input id="a-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function Account() {
  const qc = useQueryClient();
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: ({ signal }) => get<Session[]>('/auth/sessions', signal) });
  const change = useMutation({
    mutationFn: () => post('/auth/password', { current: pw.current, next: pw.next }),
    onSuccess: () => {
      setPw({ current: '', next: '', repeat: '' });
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast.success('Password changed — other devices were signed out');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const signOutOthers = useMutation({
    mutationFn: () => del<{ signedOut: number }>('/auth/sessions'),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast.success(`Signed out ${r.signedOut} other session${r.signedOut === 1 ? '' : 's'}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const mismatch = pw.repeat !== '' && pw.next !== pw.repeat;
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Change password" />
        <CardBody className="space-y-4">
          <Field label="Current password" htmlFor="pw-cur">
            <Input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="pw-new" hint="At least 10 characters with letters and digits, or 16+ characters.">
            <Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Repeat new password" htmlFor="pw-rep" error={mismatch ? 'Passwords don’t match' : null}>
            <Input id="pw-rep" type="password" autoComplete="new-password" value={pw.repeat} aria-invalid={mismatch} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button onClick={() => change.mutate()} loading={change.isPending} disabled={!pw.current || !pw.next || mismatch || pw.next !== pw.repeat}>
              Change password
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Signed-in devices"
          actions={
            (sessions.data?.length ?? 0) > 1 && (
              <Button size="sm" variant="outline" onClick={() => signOutOthers.mutate()} loading={signOutOthers.isPending}>
                <LogOut /> Sign out others
              </Button>
            )
          }
        />
        <CardBody className="space-y-3">
          {sessions.data?.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 text-[13px]">
              <div className="min-w-0">
                <p className="truncate">{describeAgent(s.userAgent)}</p>
                <p className="text-muted text-xs">
                  {s.ip ?? 'unknown IP'} · signed in {fmtDate(s.createdAt)} · active {fmtRelative(s.lastSeenAt)}
                </p>
              </div>
              {s.current && <Badge tone="success">This device</Badge>}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg(e|iOS|A)?\//.test(ua)
    ? 'Edge'
    : /Chrome\/|CriOS\//.test(ua)
      ? 'Chrome'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  // iPhone and iPad user agents also say "like Mac OS X", and Android ones say "Linux": test those first.
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' on ');
}

interface EmailSettings {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  from: string;
  to: string;
  passwordSet: boolean;
  canStorePassword: boolean;
}

function EmailAlerts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['email-settings'], queryFn: ({ signal }) => get<EmailSettings>('/email-settings', signal) });
  const [f, setF] = useState<EmailSettings | null>(null);
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (q.data) setF(q.data);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => put<EmailSettings>('/email-settings', { enabled: f!.enabled, host: f!.host, port: Number(f!.port), user: f!.user, from: f!.from, to: f!.to, ...(password ? { password } : {}) }),
    onSuccess: (s) => {
      qc.setQueryData(['email-settings'], s);
      setPassword('');
      toast.success('Email settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: () => post('/email-settings/test'),
    onSuccess: () => toast.success(`Test email sent to ${f?.to}. Check the inbox (and spam).`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isPending || !f) return <PageSkeleton />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const set = <K extends keyof EmailSettings>(k: K, v: EmailSettings[K]) => setF({ ...f, [k]: v });
  const dirty = JSON.stringify({ ...f, passwordSet: 0 }) !== JSON.stringify({ ...q.data, passwordSet: 0 }) || password !== '';

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Email me when a request arrives"
        description="Pilot, demo, partner and contact requests from scholametrix.tech are always saved under Leads. Switch this on to also get an email for each one."
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Switch checked={f.enabled} onChange={(v) => set('enabled', v)} label="Send an email for every new request" />
        </div>
        <Field label="Send alerts to" htmlFor="e-to" className="sm:col-span-2" hint="One or more addresses, separated by commas.">
          <Input id="e-to" type="email" multiple value={f.to} onChange={(e) => set('to', e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label="Mail server" htmlFor="e-host" hint="Gmail: smtp.gmail.com, port 587.">
          <Input id="e-host" value={f.host} onChange={(e) => set('host', e.target.value)} />
        </Field>
        <Field label="Port" htmlFor="e-port" hint="587 (recommended) or 465.">
          <Input id="e-port" type="number" value={f.port} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
        <Field label="Sending account" htmlFor="e-user" hint="The mailbox the alerts are sent from, e.g. your Gmail address.">
          <Input id="e-user" type="email" autoComplete="off" value={f.user} onChange={(e) => set('user', e.target.value)} />
        </Field>
        <Field
          label="App password"
          htmlFor="e-pass"
          hint={
            f.canStorePassword
              ? f.passwordSet
                ? 'A password is saved (encrypted). Leave empty to keep it.'
                : 'Gmail: Google Account → Security → 2-Step Verification → App passwords. Not your normal password.'
              : 'This server has no SECRETS_ENCRYPTION_KEY, so a password can’t be stored safely.'
          }
        >
          <Input id="e-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={f.passwordSet ? '••••••••••••••••' : ''} disabled={!f.canStorePassword} />
        </Field>
        <Field label="Show as sender (optional)" htmlFor="e-from" className="sm:col-span-2" hint="Leave empty to use the sending account. Example: Scholametrix <you@gmail.com>">
          <Input id="e-from" value={f.from} onChange={(e) => set('from', e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
          <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={dirty || !q.data?.passwordSet}>
            <Send /> Send a test email
          </Button>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-muted text-xs">Unsaved changes. Save, then send the test.</span>}
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
              <Mail /> Save
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
