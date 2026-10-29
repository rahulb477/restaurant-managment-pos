/**
 * Optional public Firebase web config. The UI talks to `/api/v1` (Next
 * route handlers). Public keys identify the project; they are not secrets
 * and are not used for authorization. Server Admin SDK verifies sessions.
 */
export function firebaseWebConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export function isFirebaseWebConfigured(): boolean {
  const c = firebaseWebConfig();
  return Boolean(c.apiKey && c.authDomain && c.projectId && c.appId);
}
