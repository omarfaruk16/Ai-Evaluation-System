import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, get, onUnauthorized } from './api';
import type { Me } from './types';

export const ME_KEY = ['auth', 'me'] as const;

/** The signed-in admin, or null when signed out. */
export function useMe() {
  const qc = useQueryClient();
  useEffect(() => onUnauthorized(() => qc.setQueryData(ME_KEY, null)), [qc]);
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Base URL clients use for the API: PUBLIC_URL from the server, else this page's origin. */
export function useApiBaseUrl(): string {
  return useMe().data?.publicUrl ?? window.location.origin;
}
