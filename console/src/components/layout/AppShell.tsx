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
import * as D from '@radix-ui/react-dialog';
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
                    'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors pointer-coarse:py-2.5 pointer-coarse:text-[15px] [&_svg]:size-4',
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

function UserMenu({ me, compact }: { me: Me; compact?: boolean }) {
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
      align={compact ? 'end' : 'start'}
      trigger={
        compact ? (
          <button className="hover:bg-surface-2 flex size-10 items-center justify-center rounded-full" aria-label={`Account: ${me.name}`}>
            <span className="bg-surface-3 flex size-8 items-center justify-center rounded-full text-xs font-semibold">{initials}</span>
          </button>
        ) : (
        <button className="hover:bg-surface-2 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left">
          <span className="bg-surface-3 flex size-8 items-center justify-center rounded-full text-xs font-semibold">{initials}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium">{me.name}</span>
            <span className="text-muted block truncate text-[11px]">{me.email}</span>
          </span>
        </button>
        )
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

/** The pages a phone reaches with one thumb; everything else is in the menu ("More"). */
const TABS = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard />, end: true },
  { to: '/projects', label: 'Projects', icon: <Building2 /> },
  { to: '/evaluations', label: 'Evaluations', icon: <ListChecks /> },
  { to: '/playground', label: 'Playground', icon: <FlaskConical /> },
];

/** Title of the current page, for the phone header. */
function currentTitle(pathname: string): string {
  if (pathname === '/') return 'Overview';
  if (pathname.startsWith('/billing/invoices/')) return 'Invoice';
  if (pathname.startsWith('/projects/')) return 'Project';
  const items = NAV.flatMap((g) => g.items).filter((i) => i.to !== '/');
  const hit = items.sort((a, b) => b.to.length - a.to.length).find((i) => pathname.startsWith(i.to));
  return hit?.label ?? 'AI Marking';
}

function BottomTabs({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation();
  const inTabs = TABS.some((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));
  const tab = 'relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[10.5px] font-medium transition-colors [&_svg]:size-5 [&_svg]:transition-transform active:[&_svg]:scale-90';
  const indicator = <span className="bg-primary absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full animate-fade-in" />;
  return (
    <nav
      aria-label="Main"
      className="bg-surface/95 pb-safe no-print fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md lg:hidden"
    >
      <div className="flex">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn(tab, isActive ? 'text-primary' : 'text-muted')}>
            {({ isActive }) => (
              <>
                {isActive && indicator}
                {t.icon}
                {t.label}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className={cn(tab, moreOpen || !inTabs ? 'text-primary' : 'text-muted')} aria-label="More pages">
          {!inTabs && indicator}
          <MenuIcon />
          More
        </button>
      </div>
    </nav>
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
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="min-h-dvh">
      <aside className="bg-surface no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex">
        <div className="flex h-14 items-center border-b px-3">
          <Brand />
        </div>
        <Nav />
        <div className="border-t p-2">
          <UserMenu me={me} />
        </div>
      </aside>

      {/* Phone / tablet menu: a drawer with focus trap, Escape and scroll lock. */}
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in lg:hidden" />
          <D.Content className="bg-surface pt-safe pb-safe fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r shadow-2xl focus:outline-none data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left lg:hidden">
            <D.Title className="sr-only">Menu</D.Title>
            <D.Description className="sr-only">All console pages</D.Description>
            <div className="flex h-14 items-center justify-between border-b px-3">
              <Brand />
              <D.Close className="text-muted hover:bg-surface-2 rounded-md p-2" aria-label="Close menu">
                <X className="size-5" />
              </D.Close>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
            <div className="border-t p-2">
              <UserMenu me={me} />
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="lg:pl-60 print:pl-0">
        <header className="bg-surface/90 pt-safe no-print sticky top-0 z-20 border-b backdrop-blur-md lg:hidden">
          <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
            <button className="hover:bg-surface-2 rounded-md p-2" onClick={() => setOpen(true)} aria-label="Open menu">
              <MenuIcon className="size-5" />
            </button>
            <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
              <FileText className="size-3.5" />
            </div>
            <p key={location.pathname} className="animate-fade-in min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
              {currentTitle(location.pathname)}
            </p>
            <div className="w-10 shrink-0">
              <UserMenu me={me} compact />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1320px] px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          {billing.isPending ? null : (
            <div key={location.pathname} className="animate-fade-up">
              <Outlet key={`${costCode ?? 'USD'}:${costRate ?? 1}`} />
            </div>
          )}
        </main>
      </div>

      <BottomTabs onMore={() => setOpen(true)} moreOpen={open} />
    </div>
  );
}
