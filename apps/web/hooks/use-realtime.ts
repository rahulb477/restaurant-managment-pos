"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { setRealtimeState } from "@/lib/realtime-status";

/**
 * Serverless-safe live updates: poll branch queries. Socket.IO is not used
 * on Vercel. When Firebase web config is present, screens still refetch on
 * an interval and on visibility — Firestore client listeners can be added
 * once NEXT_PUBLIC_FIREBASE_* is verified.
 */
export function useRealtime(branchId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!branchId) return;
    setRealtimeState("live");
    const tick = () => {
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["kds"] });
      void queryClient.invalidateQueries({ queryKey: ["floors", branchId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    };
    const id = window.setInterval(tick, 4000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      setRealtimeState("connecting");
    };
  }, [branchId, queryClient]);
}
