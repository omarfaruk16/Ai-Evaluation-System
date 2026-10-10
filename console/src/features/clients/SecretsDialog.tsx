import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton, SecretField } from '@/components/ui/controls';
import { Modal } from '@/components/ui/dialog';
import { useApiBaseUrl } from '@/lib/auth';
import { maskSecret } from '@/lib/mask';

/**
 * Shown once after a project is created or a credential is rotated. Secrets are masked on screen
 * (first 4 characters); Copy puts the full value on the clipboard.
 */
export function SecretsDialog({
  open,
  onClose,
  title,
  apiKey,
  webhookSecret,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  apiKey?: string;
  webhookSecret?: string;
}) {
  const baseUrl = useApiBaseUrl();
  const env = [
    ['AI_MARKING_URL', baseUrl],
    ...(apiKey ? [['AI_MARKING_API_KEY', apiKey]] : []),
    ...(webhookSecret ? [['AI_MARKING_WEBHOOK_SECRET', webhookSecret]] : []),
  ] as [string, string][];
  const envText = env.map(([k, v]) => `${k}=${v}`).join('\n');
  const envShown = env.map(([k, v]) => `${k}=${k === 'AI_MARKING_URL' ? v : maskSecret(v)}`).join('\n');

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} size="lg" footer={<Button onClick={onClose}>Done — I’ve copied it</Button>}>
      <div className="space-y-5">
        <div className="border-warning/30 bg-warning-soft flex gap-3 rounded-lg border px-4 py-3 text-[13px]">
          <ShieldAlert className="text-warning mt-0.5 size-4 shrink-0" />
          <p>
            Copy {apiKey ? 'the API key' : 'the secret'} now — this is the only time it can be copied. It is masked on screen; the Copy button copies the
            full value. Give it to the project’s administrator privately (not by public chat or email in plain text).
          </p>
        </div>

        <div className="grid gap-4">
          {apiKey && (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">API URL</span>
              <div className="bg-surface-2 flex items-center gap-2 rounded-md border px-3 py-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{baseUrl}</code>
                <CopyButton value={baseUrl} />
              </div>
            </div>
          )}
          {apiKey && <SecretField label="API key" value={apiKey} />}
          {!apiKey && webhookSecret && (
            <SecretField label="Webhook signing secret" value={webhookSecret} hint="Only for software that doesn’t register its own webhook." />
          )}
        </div>

        {apiKey && (
          <div className="rounded-lg border px-4 py-3.5">
            <p className="text-sm font-semibold">Connect the e-Exam system</p>
            <ol className="text-muted mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed">
              <li>Sign in to the exam system as a super admin.</li>
              <li>
                Open <span className="text-foreground font-medium">AI Marking</span> in the sidebar.
              </li>
              <li>
                Paste the API URL and API key, then press <span className="text-foreground font-medium">Connect</span>. The exam system checks the key,
                registers its webhook and tests it.
              </li>
            </ol>
            <p className="text-muted mt-3 text-xs leading-relaxed">
              Other software: call <code className="font-mono">GET /v1/me</code> with the key to check it, then{' '}
              <code className="font-mono">PUT /v1/webhook</code> to register where results are sent (see the API guide, docs/API.md).
            </p>
          </div>
        )}

        {apiKey && (
          <details className="rounded-lg border px-4 py-2.5">
            <summary className="text-muted cursor-pointer text-xs font-medium">Advanced: environment variables and webhook secret</summary>
            <div className="mt-3 space-y-4">
              {webhookSecret && (
                <SecretField
                  label="Webhook signing secret"
                  value={webhookSecret}
                  hint="Not needed when the project registers its own webhook (the e-Exam system does); registering issues a new secret."
                />
              )}
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium">As environment variables (instead of the admin page)</span>
                  <CopyButton value={envText} />
                </div>
                <pre className="bg-surface-2 overflow-x-auto rounded-md border px-3 py-2 font-mono text-[12.5px] leading-relaxed">{envShown}</pre>
              </div>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
