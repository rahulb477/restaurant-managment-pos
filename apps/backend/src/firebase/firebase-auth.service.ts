import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseAdminService } from './firebase-admin.service';

const SESSION_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class FirebaseAuthService {
  private readonly logger = new Logger(FirebaseAuthService.name);

  constructor(
    private readonly admin: FirebaseAdminService,
    private readonly config: ConfigService,
  ) {}

  provider(): 'jwt' | 'firebase' {
    return this.config.get<string>('AUTH_PROVIDER') === 'firebase'
      ? 'firebase'
      : 'jwt';
  }

  isFirebaseAuth(): boolean {
    return this.provider() === 'firebase' && this.admin.isConfigured();
  }

  async createFirebaseUser(email: string, password: string, name: string) {
    if (!this.admin.isConfigured()) return null;
    try {
      const rec = await this.admin.auth().createUser({
        email,
        password,
        displayName: name,
      });
      return rec.uid;
    } catch (err) {
      this.logger.warn(`createUser: ${String(err)}`);
      return null;
    }
  }

  async verifyBearerOrCookie(token: string) {
    if (!this.admin.isConfigured()) {
      throw new ServiceUnavailableException('Firebase Admin is not configured');
    }
    try {
      return await this.admin.auth().verifySessionCookie(token, true);
    } catch {
      try {
        return await this.admin.auth().verifyIdToken(token);
      } catch {
        throw new UnauthorizedException('Invalid Firebase session');
      }
    }
  }

  async sessionCookieFromIdToken(idToken: string): Promise<string> {
    if (!this.admin.isConfigured()) {
      throw new ServiceUnavailableException('Firebase Admin is not configured');
    }
    return this.admin.auth().createSessionCookie(idToken, {
      expiresIn: SESSION_MS,
    });
  }

  /**
   * Email/password via Identity Toolkit. The web API key is not a secret;
   * authorization is still Admin session cookies + Nest RBAC.
   */
  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<string | null> {
    const apiKey =
      this.config.get<string>('FIREBASE_WEB_API_KEY') ??
      this.config.get<string>('NEXT_PUBLIC_FIREBASE_API_KEY');
    if (!apiKey) return null;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const json = (await res.json()) as { idToken?: string; error?: unknown };
    if (!res.ok || !json.idToken) return null;
    return json.idToken;
  }

  async passwordResetLink(email: string): Promise<string | null> {
    if (!this.admin.isConfigured()) return null;
    try {
      return await this.admin.auth().generatePasswordResetLink(email);
    } catch (err) {
      this.logger.warn(`password reset: ${String(err)}`);
      return null;
    }
  }
}
