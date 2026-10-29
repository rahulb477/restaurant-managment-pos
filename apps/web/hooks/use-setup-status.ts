"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SetupAccess } from "@/lib/onboarding";

// The authenticated account's own membership and setup state, not a global
// check for whether some other restaurant exists.
export function useSetupStatus() {
  return useQuery({
    queryKey: ["auth", "setup-status"],
    queryFn: () => api.get<SetupAccess>("/auth/setup-status"),
    staleTime: 60_000,
  });
}
