import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import type { BillingSettings, ModelsResponse, Plan, UnitCosts } from '@/lib/types';

export const usePlans = () => useQuery({ queryKey: ['plans'], queryFn: ({ signal }) => get<Plan[]>('/plans', signal) });

export const useBillingSettings = () =>
  useQuery({ queryKey: ['billing', 'settings'], queryFn: ({ signal }) => get<BillingSettings>('/billing/settings', signal), staleTime: 60_000 });

export const useModels = () => useQuery({ queryKey: ['models'], queryFn: ({ signal }) => get<ModelsResponse>('/models', signal) });

export const useUnitCosts = (days = 30) =>
  useQuery({ queryKey: ['billing', 'unit-costs', days], queryFn: ({ signal }) => get<UnitCosts>(`/billing/unit-costs?days=${days}`, signal) });
