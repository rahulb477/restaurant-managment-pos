"use client";

import { permissionSatisfied, type LoginDto, type SessionUser } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SetupAccess, SignupDto } from "@/lib/onboarding";

type AuthResult = { user: SessionUser; setup: SetupAccess };

export function useCurrentUser() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthResult>("/auth/me"),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: LoginDto) => api.post<AuthResult>("/auth/login", dto),
    onSuccess: (data) => {
      // No cached tenant data may survive a change of account.
      queryClient.clear();
      queryClient.setQueryData(["auth", "me"], data);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SignupDto) => api.post<AuthResult>("/auth/register", dto),
    onSuccess: (data) => {
      queryClient.clear();
      queryClient.setQueryData(["auth", "me"], data);
    },
  });
}

export function usePasswordReset() {
  return useMutation({
    mutationFn: (email: string) => api.post("/auth/password-reset", { email }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function hasPermission(user: SessionUser | undefined, permission: string): boolean {
  return user ? permissionSatisfied(user.permissions, permission) : false;
}
