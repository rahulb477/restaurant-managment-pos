type AdminNs = {
  apps: unknown[];
  initializeApp: (o: unknown) => unknown;
  credential: { cert: (c: unknown) => unknown };
  auth: () => ReturnType<typeof authShape>;
  firestore: () => ReturnType<typeof firestoreShape>;
};

function authShape() {
  return {} as {
    verifySessionCookie: (t: string, check?: boolean) => Promise<{ uid: string; email?: string }>;
    createSessionCookie: (idToken: string, opts: { expiresIn: number }) => Promise<string>;
    createUser: (u: { email: string; password: string; displayName?: string }) => Promise<{ uid: string }>;
    generatePasswordResetLink: (email: string) => Promise<string>;
  };
}

function firestoreShape() {
  return {} as {
    collection: (name: string) => {
      doc: (id?: string) => {
        id: string;
        get: () => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> | undefined }>;
        set: (data: unknown, opts?: { merge?: boolean }) => Promise<unknown>;
        delete: () => Promise<unknown>;
      };
      where: (f: string, op: string, v: unknown) => Query;
      limit: (n: number) => Query;
    };
    runTransaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  };
}

type Query = {
  where: (f: string, op: string, v: unknown) => Query;
  orderBy: (f: string, dir?: string) => Query;
  limit: (n: number) => Query;
  get: () => Promise<{ docs: { id: string; data: () => Record<string, unknown> }[] }>;
};

type Tx = {
  get: (ref: { id: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  set: (ref: unknown, data: unknown, opts?: { merge?: boolean }) => void;
  update: (ref: unknown, data: unknown) => void;
};

export function firebaseConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY,
  );
}

export function getAdmin(): AdminNs {
  if (!firebaseConfigured()) {
    throw new Error("Firebase Admin is not configured");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const admin = require("firebase-admin") as AdminNs;
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin;
}

export function db() {
  return getAdmin().firestore();
}

export function adminAuth() {
  return getAdmin().auth();
}
