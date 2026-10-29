"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/use-auth";

// Optional gate for a page that wants to send signed-in users into the app.
// The root makes the server-side setup decision; /about deliberately does not
// use this gate so the public product page stays accessible to everyone.
export function AuthRedirectGate() {
  const { data, isSuccess } = useCurrentUser();
  const router = useRouter();

  useEffect(() => {
    if (isSuccess && data?.user) {
      router.replace("/");
    }
  }, [isSuccess, data, router]);

  return null;
}
