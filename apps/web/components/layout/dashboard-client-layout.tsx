"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { useCurrentUser } from "@/hooks/use-auth";
import { BranchProvider, useBranch } from "@/hooks/use-branch";
import { useRealtime } from "@/hooks/use-realtime";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { canOpen, firstAllowedHref } from "@/lib/route-access";
import { ApiError } from "@/lib/api";

// Subscribes every route in this layout group to realtime push (order/KOT/
// table updates) instead of only the one page (KDS) that happened to call
// useRealtime itself — the Dashboard summary page had NO push subscription
// at all and relied solely on its own 15s/60s polling (see use-dashboard.ts),
// so a payment completed at one terminal took up to 15s to show up on a
// manager's dashboard tab elsewhere, or never did if that tab predates the
// poll window. Rendered as a child of BranchProvider (not the layout
// component itself) since useBranch() needs to run below the provider.
function RealtimeBridge() {
  const { branchId } = useBranch();
  useRealtime(branchId);
  return null;
}

export function DashboardClientLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading, isError, error, refetch } = useCurrentUser();
  const permissions = data?.user.permissions;
  const allowed = !permissions || canOpen(pathname ?? "", permissions, NAV_ITEMS);
  const fallback = permissions ? firstAllowedHref(permissions, NAV_ITEMS) : undefined;

  useEffect(() => {
    if (!isLoading && isError && error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      router.replace("/login");
    } else if (data && data.setup.status !== "ready") {
      router.replace("/setup");
    }
  }, [data, error, isLoading, isError, router]);

  // Direct URL to a page the role may not use (e.g. a waiter opening /dashboard
  // after login): send them to their first permitted screen.
  useEffect(() => {
    if (data?.setup.status === "ready" && !allowed && fallback && fallback !== pathname) router.replace(fallback);
  }, [allowed, data, fallback, pathname, router]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-background" />;
  }

  if (isError || !data) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p>Could not verify your session. Check your connection and try again.</p>
        <button type="button" className="underline" onClick={() => void refetch()}>Try again</button>
      </div>
    );
  }

  if (data.setup.status !== "ready") return null;

  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        {fallback ? "Redirecting…" : "Your role has no access to this page. Ask an administrator."}
      </div>
    );
  }

  return (
    <BranchProvider>
      <RealtimeBridge />
      <AppShell user={data.user}>{children}</AppShell>
    </BranchProvider>
  );
}
