import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ErrorState, PageSkeleton } from './components/ui/page';
import { LoginPage } from './features/auth/LoginPage';
import { useMe } from './lib/auth';

const OverviewPage = lazy(() => import('./features/overview/OverviewPage'));
const ClientsPage = lazy(() => import('./features/clients/ClientsPage'));
const ClientDetailPage = lazy(() => import('./features/clients/ClientDetailPage'));
const ModelsPage = lazy(() => import('./features/models/ModelsPage'));
const PlansPage = lazy(() => import('./features/pricing/PlansPage'));
const QuotePage = lazy(() => import('./features/pricing/QuotePage'));
const StatementsPage = lazy(() => import('./features/billing/StatementsPage'));
const InvoicesPage = lazy(() => import('./features/billing/InvoicesPage'));
const InvoicePage = lazy(() => import('./features/billing/InvoicePage'));
const EvaluationsPage = lazy(() => import('./features/evaluations/EvaluationsPage'));
const PlaygroundPage = lazy(() => import('./features/playground/PlaygroundPage'));
const WebhooksPage = lazy(() => import('./features/webhooks/WebhooksPage'));
const SystemPage = lazy(() => import('./features/system/SystemPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

export function App() {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="border-muted/30 border-t-primary size-6 animate-spin rounded-full border-2" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (!me.data) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppShell me={me.data} />}>
        <Route
          path="*"
          element={
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route index element={<OverviewPage />} />
                <Route path="projects" element={<ClientsPage />} />
                <Route path="projects/:id" element={<ClientDetailPage />} />
                <Route path="clients/*" element={<Navigate to="/projects" replace />} />
                <Route path="models" element={<ModelsPage />} />
                <Route path="pricing" element={<PlansPage />} />
                <Route path="pricing/quote" element={<QuotePage />} />
                <Route path="billing" element={<StatementsPage />} />
                <Route path="billing/invoices" element={<InvoicesPage />} />
                <Route path="billing/invoices/:id" element={<InvoicePage />} />
                <Route path="evaluations" element={<EvaluationsPage />} />
                <Route path="playground" element={<PlaygroundPage />} />
                <Route path="webhooks" element={<WebhooksPage />} />
                <Route path="system" element={<SystemPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="login" element={<Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
