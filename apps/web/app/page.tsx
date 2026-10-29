import { redirect } from "next/navigation";
import { destinationFor } from "@/lib/onboarding";
import { db } from "@/lib/server/firebase";
import { getSetupDetails } from "@/lib/server/onboarding";
import { optionalAccount } from "@/lib/server/session";

// Read the verified Firebase session and its own Firestore membership on
// every request. A restaurant elsewhere in the database is not setup state.
export default async function HomePage() {
  const account = await optionalAccount();
  const setup = account ? await getSetupDetails(db(), account) : null;
  redirect(destinationFor(setup));
}
