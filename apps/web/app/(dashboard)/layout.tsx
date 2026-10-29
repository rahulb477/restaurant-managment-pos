import { redirect } from "next/navigation";
import { DashboardClientLayout } from "@/components/layout/dashboard-client-layout";
import { db } from "@/lib/server/firebase";
import { getSetupDetails } from "@/lib/server/onboarding";
import { optionalAccount } from "@/lib/server/session";

// This route group covers the dashboard and all staff POS screens. The API
// independently repeats these checks because layouts may be cached on client
// navigation and are not an authorization boundary for data access.
export default async function DashboardGroupLayout({ children }: { children: React.ReactNode }) {
  const account = await optionalAccount();
  if (!account) redirect("/login");
  const setup = await getSetupDetails(db(), account);
  if (setup.status !== "ready") redirect("/setup");
  return <DashboardClientLayout>{children}</DashboardClientLayout>;
}
