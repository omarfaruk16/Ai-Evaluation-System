import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  Calculator,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Receipt,
  Settings,
  Sun,
  Tags,
  Webhook,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useBillingSettings } from '@/features/shared/queries';
import { setCostCurrency } from '@/lib/format';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { post } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { cn } from '@/lib/utils';

const NAV: { section: string; items: { to: string; label: string; icon: ReactNode; end?: boolean }[] }[] = [
  {
    section: '',
    items: [{ to: '/', label: 'Overview', icon: <LayoutDashboard />, end: true }],
  },
  {
    section: 'Business',
    items: [
      { to: '/projects', label: 'Projects', icon: <Building2 /> },
      { to: '/billing', label: 'Statements', icon: <BarChart3 />, end: true },
      { to: '/billing/invoices', label: 'Invoices', icon: <Receipt /> },
      { to: '/pricing', label: 'Pricing plans', icon: <Tags />, end: true },
      { to: '/pricing/quote', label: 'Quote calculator', icon: <Calculator /> },
    ],
  },
  {
    section: 'AI',
    items: [
      { to: '/models', label: 'Models & providers', icon: <Bot /> },
      { to: '/playground', label: 'Playground', icon: <FlaskConical /> },
    ],
  },
  {
    section: 'Operations',
    items: [
      { to: '/evaluations', label: 'Evaluations', icon: <ListChecks /> },
      { to: '/webhooks', label: 'Webhooks', icon: <Webhook /> },
      { to: '/system', label: 'System', icon: <Activity /> },
      { to: '/settings', label: 'Settings', icon: <Settings /> },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
        <FileText className="size-4" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">AI Marking</p>
        <p className="text-muted text-[11px]">Operator console</p>
      </div>
    </div>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => (
        <div key={group.section || 'main'}>
          {group.section && <p className="text-subtle mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider uppercase">{group.section}</p>}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors [&_svg]:size-4',
                    isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-foreground',
                  )
                }
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function UserMenu({ me }: { me: Me }) {
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initials = me.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <Menu
      align="start"
      trigger={
        <button className="hover:bg-surface-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left">
          <span className="bg-surface-3 flex size-8 items-center justify-center rounded-full text-xs font-semibold">{initials}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium">{me.name}</span>
            <span className="text-muted block truncate text-[11px]">{me.email}</span>
          </span>
        </button>
      }
    >
      <MenuLabel>Theme</MenuLabel>
      {(
        [
          ['light', 'Light', <Sun key="s" />],
          ['dark', 'Dark', <Moon key="m" />],
          ['system', 'System', <Monitor key="c" />],
        ] as const
      ).map(([value, label, icon]) => (
        <MenuItem key={value} onSelect={() => setTheme(value)}>
          {icon}
          <span className="flex-1">{label}</span>
          {theme === value && <span className="text-primary text-xs">●</span>}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onSelect={() => navigate('/settings?tab=account')}>
        <Settings />
        Account settings
      </MenuItem>
      <MenuItem
        onSelect={async () => {
          await post('/auth/logout').catch(() => undefined);
          qc.setQueryData(ME_KEY, null);
          qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
        }}
      >
        <LogOut />
        Sign out
      </MenuItem>
    </Menu>
  );
}

export function AppShell({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  // AI costs are shown in the default billing currency; pages wait for its rate so they never
  // flash dollars first, and remount when the currency or rate changes.
  const billing = useBillingSettings();
  const costCode = billing.data?.defaultCurrency;
  const costRate = costCode ? billing.data?.fxRates[costCode] : undefined;
  setCostCurrency(costCode, costRate);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const sidebar = (
    <>
      <div className="flex h-14 items-center border-b px-3">
        <Brand />
      </div>
      <Nav onNavigate={() => setOpen(false)} />
      <div className="border-t p-2">
        <UserMenu me={me} />
      </div>
    </>
  );

  return (
    <div className="min-h-dvh">
      <aside className="bg-surface no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="bg-surface absolute inset-y-0 left-0 flex w-64 flex-col border-r shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-60 print:pl-0">
        <header className="bg-surface/90 sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur lg:hidden no-print">
          <button className="hover:bg-surface-2 rounded-md p-1.5" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
          <Brand />
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          {billing.isPending ? null : <Outlet key={`${costCode ?? 'USD'}:${costRate ?? 1}`} />}
        </main>
      </div>
    </div>
  );
}
