import * as D from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  Calculator,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Plus,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tags,
  Webhook,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import { useBillingSettings } from '@/features/shared/queries';
import { post } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';
import { setCostCurrency } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import type { Me } from '@/lib/types';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  /** Extra words the search palette matches on. */
  keywords?: string;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: '',
    items: [{ to: '/', label: 'Overview', icon: <LayoutDashboard />, end: true, keywords: 'dashboard home' }],
  },
  {
    section: 'Business',
    items: [
      { to: '/projects', label: 'Projects', icon: <Building2 />, keywords: 'clients customers api keys' },
      { to: '/leads', label: 'Leads', icon: <Inbox />, keywords: 'website pilot demo contact sponsor requests sales' },
      { to: '/billing', label: 'Statements', icon: <BarChart3 />, end: true, keywords: 'billing month revenue margin' },
      { to: '/billing/invoices', label: 'Invoices', icon: <Receipt />, keywords: 'bills paid due' },
      { to: '/pricing', label: 'Pricing plans', icon: <Tags />, end: true, keywords: 'prices plans' },
      { to: '/pricing/quote', label: 'Quote calculator', icon: <Calculator />, keywords: 'estimate price' },
    ],
  },
  {
    section: 'AI',
    items: [
      { to: '/models', label: 'Models & providers', icon: <Bot />, keywords: 'openrouter deepseek llm profiles hosts' },
      { to: '/playground', label: 'Playground', icon: <FlaskConical />, keywords: 'try test mark rubric' },
    ],
  },
  {
    section: 'Operations',
    items: [
      { to: '/evaluations', label: 'Evaluations', icon: <ListChecks />, keywords: 'answers marked results' },
      { to: '/webhooks', label: 'Webhooks', icon: <Webhook />, keywords: 'deliveries callbacks' },
      { to: '/system', label: 'System', icon: <Activity />, keywords: 'queues workers health' },
      { to: '/settings', label: 'Settings', icon: <Settings />, keywords: 'business currency admins account password' },
    ],
  },
];
const ALL = NAV.flatMap((g) => g.items.map((i) => ({ ...i, section: g.section })));

/** The current page and its section, for the breadcrumb and the phone header. */
function where(pathname: string): { section: string; title: string; parent?: { to: string; label: string } } {
  if (pathname === '/') return { section: '', title: 'Overview' };
  if (pathname.startsWith('/billing/invoices/')) return { section: 'Business', title: 'Invoice', parent: { to: '/billing/invoices', label: 'Invoices' } };
  if (pathname.startsWith('/projects/')) return { section: 'Business', title: 'Project', parent: { to: '/projects', label: 'Projects' } };
  const hit = ALL.filter((i) => i.to !== '/')
    .sort((a, b) => b.to.length - a.to.length)
    .find((i) => pathname.startsWith(i.to));
  return hit ? { section: hit.section, title: hit.label } : { section: '', title: 'AI Marking' };
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="from-accent to-primary flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-[0_8px_18px_-8px_var(--primary)]">
        <Sparkles className="size-[18px]" />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-bold tracking-tight">AI Marking</p>
          <p className="text-muted text-[11px] font-medium">Operator console</p>
        </div>
      )}
    </div>
  );
}

/** Sidebar navigation. The active highlight slides to the current page. */
function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    const active = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    setPill(active && nav ? { top: active.offsetTop, height: active.offsetHeight } : null);
  }, [pathname]);

  return (
    <nav ref={ref} className="relative flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {pill && (
        <span
          aria-hidden
          className="bg-primary absolute right-3 left-3 rounded-xl shadow-[0_8px_18px_-8px_var(--primary)] transition-[transform,height] duration-300 ease-[var(--ease-out-soft)]"
          style={{ transform: `translateY(${pill.top}px)`, height: pill.height, top: 0 }}
        />
      )}
      {NAV.map((group) => (
        <div key={group.section || 'main'}>
          {group.section && <p className="text-muted mb-1.5 px-3 text-[11px] font-semibold tracking-wider uppercase">{group.section}</p>}
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'relative z-10 flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition-colors duration-200 pointer-coarse:py-2.5 pointer-coarse:text-[15px] [&_svg]:size-[18px]',
                    isActive ? 'text-primary-foreground' : 'text-muted hover:bg-surface-2 hover:text-foreground',
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

/** The sidebar's call to action, like a promo card: onboarding a new customer is the core job. */
function NewProjectCard({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="bg-primary-soft relative mx-3 mb-3 overflow-hidden rounded-2xl p-4">
      <div aria-hidden className="bg-accent/25 absolute -top-8 -right-8 size-24 rounded-full blur-2xl" />
      <p className="relative text-[13.5px] leading-snug font-bold">Onboard a new school</p>
      <p className="text-muted relative mt-1 text-xs leading-relaxed">Create a project to get its API key in seconds.</p>
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          navigate('/projects?new=1');
        }}
        className="bg-primary text-primary-foreground hover:bg-primary-hover relative mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold transition-colors active:scale-[0.98]"
      >
        <Plus className="size-4" /> New project
      </button>
    </div>
  );
}

function UserMenu({ me, variant }: { me: Me; variant: 'sidebar' | 'topbar' | 'compact' }) {
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const initials = initialsOf(me.name);
  const avatar = (
    <span className="from-accent-soft to-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold ring-2 ring-white dark:ring-transparent">
      {initials}
    </span>
  );
  return (
    <Menu
      align={variant === 'sidebar' ? 'start' : 'end'}
      trigger={
        variant === 'compact' ? (
          <button className="hover:bg-surface-2 flex size-10 cursor-pointer items-center justify-center rounded-full" aria-label={`Account: ${me.name}`}>
            {avatar}
          </button>
        ) : (
          <button
            className={cn(
              'hover:bg-surface-2 flex cursor-pointer items-center gap-2.5 rounded-xl text-left transition-colors',
              variant === 'sidebar' ? 'w-full px-2 py-2' : 'py-1 pr-2 pl-1',
            )}
          >
            {avatar}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold">{me.name}</span>
              <span className="text-muted block truncate text-[11px]">{variant === 'topbar' ? 'Operator' : me.email}</span>
            </span>
            <ChevronDown className="text-muted size-4 shrink-0" />
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
          {theme === value && <span className="bg-primary size-1.5 rounded-full" />}
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

/** Light ⇄ dark in one tap (System stays available in the account menu). */
function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="bg-surface text-muted hover:text-foreground shadow-card flex size-10 cursor-pointer items-center justify-center rounded-xl transition-colors dark:border dark:border-border"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      <span key={dark ? 'd' : 'l'} className="animate-pop-in">
        {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </span>
    </button>
  );
}

const ACTIONS = [
  { id: 'new-project', label: 'New project', hint: 'Create an API key for a customer', to: '/projects?new=1', icon: <Plus /> },
  { id: 'quote', label: 'Make a quote', hint: 'Price a new customer', to: '/pricing/quote', icon: <Calculator /> },
  { id: 'try', label: 'Try marking an answer', hint: 'Open the playground', to: '/playground', icon: <FlaskConical /> },
];

/** "Search anything": jump to any page or action. Opens with ⌘K / Ctrl+K or "/". */
function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = ALL.map((p) => ({ id: p.to, label: p.label, hint: p.section || 'Console', to: p.to, icon: p.icon, words: `${p.label} ${p.keywords ?? ''} ${p.section}`.toLowerCase() }));
    const acts = ACTIONS.map((a) => ({ ...a, words: `${a.label} ${a.hint}`.toLowerCase() }));
    const all = [...acts, ...pages];
    return term ? all.filter((r) => term.split(/\s+/).every((t) => r.words.includes(t))) : all;
  }, [q]);
  useEffect(() => {
    if (!open) setQ('');
    setIndex(0);
  }, [open, q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <D.Content
          className="bg-surface fixed inset-x-3 top-[12vh] z-50 mx-auto max-w-xl overflow-hidden rounded-2xl border shadow-2xl focus:outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">Search the console</D.Title>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="text-muted size-[18px] shrink-0" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(results.length - 1, i + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && results[index]) {
                  e.preventDefault();
                  go(results[index].to);
                }
              }}
              placeholder="Search pages and actions…"
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle sm:text-[15px]"
              aria-label="Search pages and actions"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={results[index] ? `palette-${results[index].id}` : undefined}
            />
            <kbd className="text-muted bg-surface-2 hidden rounded-md border px-1.5 py-0.5 text-[11px] font-semibold sm:inline">Esc</kbd>
          </div>
          <div ref={listRef} id="palette-list" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="text-muted px-3 py-10 text-center text-sm">Nothing matches “{q}”.</p>
            ) : (
              results.map((r, i) => (
                <button
                  key={r.id}
                  id={`palette-${r.id}`}
                  role="option"
                  aria-selected={i === index}
                  data-index={i}
                  type="button"
                  onMouseMove={() => setIndex(i)}
                  onClick={() => go(r.to)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                    i === index ? 'bg-primary-soft text-primary' : 'text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
                      i === index ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {r.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.label}</span>
                    <span className="text-muted block truncate text-xs">{r.hint}</span>
                  </span>
                  {i === index && <CornerDownLeft className="size-4 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** The pages a phone reaches with one thumb; everything else is in the menu ("More"). */
const TABS = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard />, end: true },
  { to: '/projects', label: 'Projects', icon: <Building2 /> },
  { to: '/evaluations', label: 'Evaluations', icon: <ListChecks /> },
  { to: '/playground', label: 'Playground', icon: <FlaskConical /> },
];

function BottomTabs({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { pathname } = useLocation();
  const inTabs = TABS.some((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));
  const tab = 'group flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[10.5px] font-semibold transition-colors';
  const chip = (on: boolean) =>
    cn(
      'flex h-8 w-14 items-center justify-center rounded-full transition-[background-color,transform] duration-300 group-active:scale-90 [&_svg]:size-5',
      on ? 'bg-primary-soft' : '',
    );
  return (
    <nav aria-label="Main" className="bg-surface/95 pb-safe no-print fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md lg:hidden">
      <div className="flex">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn(tab, isActive ? 'text-primary' : 'text-muted')}>
            {({ isActive }) => (
              <>
                <span className={chip(isActive)}>{t.icon}</span>
                {t.label}
              </>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={onMore} className={cn(tab, moreOpen || !inTabs ? 'text-primary' : 'text-muted')} aria-label="More pages">
          <span className={chip(moreOpen || !inTabs)}>
            <MenuIcon />
          </span>
          More
        </button>
      </div>
    </nav>
  );
}

export function AppShell({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  // AI costs are shown in the default billing currency; pages wait for its rate so they never
  // flash dollars first, and remount when the currency or rate changes.
  const billing = useBillingSettings();
  const costCode = billing.data?.defaultCurrency;
  const costRate = costCode ? billing.data?.fxRates[costCode] : undefined;
  setCostCurrency(costCode, costRate);
  const location = useLocation();
  const here = where(location.pathname);
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  // ⌘K / Ctrl+K anywhere; "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="min-h-dvh">
      {/* Desktop: a floating sidebar */}
      <aside className="bg-surface shadow-card no-print fixed inset-y-3 left-3 z-30 hidden w-64 flex-col rounded-3xl border border-transparent lg:flex dark:border-border">
        <div className="flex h-[72px] items-center px-5">
          <Brand />
        </div>
        <Nav />
        <NewProjectCard />
      </aside>

      {/* Phone / tablet menu: a drawer with focus trap, Escape and scroll lock. */}
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in lg:hidden" />
          <D.Content className="bg-surface pt-safe pb-safe fixed inset-y-0 left-0 z-50 flex w-[min(19rem,86vw)] flex-col rounded-r-3xl shadow-2xl focus:outline-none data-[state=closed]:animate-slide-out-left data-[state=open]:animate-slide-in-left lg:hidden">
            <D.Title className="sr-only">Menu</D.Title>
            <D.Description className="sr-only">All console pages</D.Description>
            <div className="flex h-16 items-center justify-between px-5">
              <Brand />
              <D.Close className="text-muted hover:bg-surface-2 cursor-pointer rounded-xl p-2" aria-label="Close menu">
                <X className="size-5" />
              </D.Close>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
            <NewProjectCard onNavigate={() => setOpen(false)} />
            <div className="border-t p-2">
              <UserMenu me={me} variant="sidebar" />
            </div>
          </D.Content>
        </D.Portal>
      </D.Root>

      <CommandPalette open={palette} onOpenChange={setPalette} />

      <div className="flex min-h-dvh flex-col lg:pl-[17.5rem] print:pl-0">
        {/* Top bar */}
        <header className="bg-background/80 pt-safe no-print sticky top-0 z-20 backdrop-blur-md">
          <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center gap-2 px-3 sm:px-6 lg:h-[76px] lg:gap-3 lg:px-8">
            <button className="hover:bg-surface-2 cursor-pointer rounded-xl p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <MenuIcon className="size-5" />
            </button>
            <div className="lg:hidden">
              <Brand compact />
            </div>

            {/* Breadcrumb (desktop) / page title (phone) */}
            <div className="min-w-0 flex-1">
              <p key={location.pathname} className="animate-fade-in truncate text-[15px] font-bold tracking-tight lg:hidden">
                {here.title}
              </p>
              <nav aria-label="Breadcrumb" className="text-muted hidden items-center gap-1.5 text-[13px] font-medium lg:flex">
                <NavLink to="/" className="hover:text-foreground">
                  Console
                </NavLink>
                {here.section && (
                  <>
                    <ChevronRight className="size-3.5" />
                    <span>{here.section}</span>
                  </>
                )}
                {here.parent && (
                  <>
                    <ChevronRight className="size-3.5" />
                    <NavLink to={here.parent.to} className="hover:text-foreground">
                      {here.parent.label}
                    </NavLink>
                  </>
                )}
                {location.pathname !== '/' && (
                  <>
                    <ChevronRight className="size-3.5" />
                    <span className="text-foreground font-semibold">{here.title}</span>
                  </>
                )}
              </nav>
            </div>

            <button
              type="button"
              onClick={() => setPalette(true)}
              className="bg-surface text-muted hover:text-foreground shadow-card hidden h-10 w-64 cursor-pointer items-center gap-2.5 rounded-xl px-3.5 text-sm transition-colors md:flex xl:w-80 dark:border dark:border-border"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Search anything</span>
              <kbd className="bg-surface-2 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold">{mac ? '⌘K' : 'Ctrl K'}</kbd>
            </button>
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="hover:bg-surface-2 text-muted cursor-pointer rounded-xl p-2 md:hidden"
              aria-label="Search"
            >
              <Search className="size-5" />
            </button>
            <div className="hidden lg:block">
              <ThemeToggle />
            </div>
            <div className="hidden lg:block">
              <UserMenu me={me} variant="topbar" />
            </div>
            <div className="lg:hidden">
              <UserMenu me={me} variant="compact" />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-2 pb-[calc(5.75rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-8 print:max-w-none print:p-0">
          {billing.isPending ? null : (
            <div key={location.pathname} className="animate-fade-up">
              <Outlet key={`${costCode ?? 'USD'}:${costRate ?? 1}`} />
            </div>
          )}
        </main>

        <footer className="no-print text-muted mx-auto hidden w-full max-w-[1320px] flex-wrap items-center justify-between gap-3 px-8 pb-6 text-xs lg:flex">
          <span>© {new Date().getFullYear()} AI Marking · Operator console</span>
          <span className="flex items-center gap-4">
            <NavLink to="/system" className="hover:text-foreground">
              System status
            </NavLink>
            <NavLink to="/settings" className="hover:text-foreground">
              Settings
            </NavLink>
            <button type="button" onClick={() => setPalette(true)} className="hover:text-foreground inline-flex cursor-pointer items-center gap-1">
              Search <ArrowRight className="size-3" />
            </button>
          </span>
        </footer>
      </div>

      <BottomTabs onMore={() => setOpen(true)} moreOpen={open} />
    </div>
  );
}
