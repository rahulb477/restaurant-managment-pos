import { redirect } from "next/navigation";
import { SetupScreen } from "@/components/setup/setup-screen";
import { db } from "@/lib/server/firebase";
import { getSetupDetails } from "@/lib/server/onboarding";
import { optionalAccount } from "@/lib/server/session";

export default async function SetupPage() {
  const account = await optionalAccount();
  if (!account) redirect("/login");

  const setup = await getSetupDetails(db(), account);
  if (setup.status === "ready") redirect("/dashboard");

  // Do not send restaurant details or render a form for an unauthorized
  // account. That user can sign out or ask their administrator for access.
  return <SetupScreen initialValues={setup.canSetup ? setup.initialValues : undefined} />;
}
