export type DocumentSnapshot = {
  exists: boolean;
  id: string;
  data: () => Record<string, unknown> | undefined;
};

export type DocumentReference = {
  id: string;
  get: () => Promise<DocumentSnapshot>;
  set: (data: unknown, opts?: { merge?: boolean }) => Promise<unknown>;
  delete: () => Promise<unknown>;
};

export type QuerySnapshot = {
  docs: { id: string; data: () => Record<string, unknown> }[];
};

export type Query = {
  where: (f: string, op: string, v: unknown) => Query;
  orderBy: (f: string, dir?: string) => Query;
  limit: (n: number) => Query;
  get: () => Promise<QuerySnapshot>;
};

export type Transaction = {
  get: {
    (ref: DocumentReference): Promise<DocumentSnapshot>;
    (ref: Query): Promise<QuerySnapshot>;
  };
  set: (ref: DocumentReference, data: unknown, opts?: { merge?: boolean }) => void;
  update: (ref: DocumentReference, data: unknown) => void;
};

export type Firestore = {
  collection: (name: string) => {
    doc: (id?: string) => DocumentReference;
    where: (f: string, op: string, v: unknown) => Query;
    limit: (n: number) => Query;
  };
  runTransaction: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
};

type AdminNs = {
  apps: unknown[];
  initializeApp: (o: unknown) => unknown;
  credential: { cert: (c: unknown) => unknown };
  auth: () => {
    verifySessionCookie: (t: string, check?: boolean) => Promise<{ uid: string; email?: string }>;
    createSessionCookie: (idToken: string, opts: { expiresIn: number }) => Promise<string>;
    createUser: (u: { email: string; password: string; displayName?: string }) => Promise<{ uid: string }>;
    deleteUser: (uid: string) => Promise<void>;
    generatePasswordResetLink: (email: string) => Promise<string>;
  };
  firestore: () => Firestore;
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

export function db(): Firestore {
  return getAdmin().firestore();
}

export function adminAuth() {
  return getAdmin().auth();
}
