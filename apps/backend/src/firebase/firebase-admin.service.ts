import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Lazy Firebase Admin wrapper. The `firebase-admin` package is optional so
 * the default Postgres/JWT install still boots when credentials are absent.
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app: { auth: () => unknown; firestore: () => unknown } | null = null;
  private configured = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config
      .get<string>('FIREBASE_PRIVATE_KEY')
      ?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Firebase Admin not configured (FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY). AUTH_PROVIDER=firebase and DATA_STORE=firestore will no-op.',
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const admin = require('firebase-admin') as {
        apps: unknown[];
        initializeApp: (opts: unknown) => { auth: () => unknown; firestore: () => unknown };
        credential: { cert: (c: unknown) => unknown };
      };
      if (admin.apps.length === 0) {
        this.app = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      } else {
        this.app = admin.apps[0] as typeof this.app;
      }
      this.configured = true;
      this.logger.log('Firebase Admin initialized');
    } catch (err) {
      this.logger.warn(
        `firebase-admin package missing or failed to init: ${String(err)}`,
      );
    }
  }

  isConfigured(): boolean {
    return this.configured && this.app != null;
  }

  auth(): {
    verifyIdToken: (t: string) => Promise<{ uid: string; email?: string }>;
    verifySessionCookie: (
      t: string,
      checkRevoked?: boolean,
    ) => Promise<{ uid: string; email?: string }>;
    createSessionCookie: (
      idToken: string,
      opts: { expiresIn: number },
    ) => Promise<string>;
    createUser: (u: {
      email: string;
      password: string;
      displayName?: string;
    }) => Promise<{ uid: string }>;
    generatePasswordResetLink: (email: string) => Promise<string>;
  } {
    if (!this.app) {
      throw new Error('Firebase Admin is not configured');
    }
    return this.app.auth() as ReturnType<FirebaseAdminService['auth']>;
  }

  firestore(): {
    collection: (name: string) => {
      doc: (id?: string) => {
        id: string;
        set: (data: unknown, opts?: unknown) => Promise<unknown>;
        get: () => Promise<{ exists: boolean; data: () => unknown }>;
      };
      where: (...args: unknown[]) => { get: () => Promise<{ docs: { id: string; data: () => unknown }[] }> };
    };
    runTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    batch: () => {
      set: (ref: unknown, data: unknown) => unknown;
      commit: () => Promise<unknown>;
    };
  } {
    if (!this.app) {
      throw new Error('Firebase Admin is not configured');
    }
    return this.app.firestore() as ReturnType<FirebaseAdminService['firestore']>;
  }
}
