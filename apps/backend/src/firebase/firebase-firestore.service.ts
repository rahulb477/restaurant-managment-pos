import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseAdminService } from './firebase-admin.service';

export const FIRESTORE_COLLECTIONS = {
  restaurants: 'restaurants',
  branches: 'branches',
  users: 'users',
  roles: 'roles',
  menuCategories: 'menuCategories',
  menuItems: 'menuItems',
  tables: 'tables',
  orders: 'orders',
  orderItems: 'orderItems',
  kitchenTickets: 'kitchenTickets',
  payments: 'payments',
  refunds: 'refunds',
  customers: 'customers',
  inventory: 'ingredients',
  stockMovements: 'stockMovements',
  auditLogs: 'auditLogs',
  images: 'images',
} as const;

@Injectable()
export class FirebaseFirestoreService {
  private readonly logger = new Logger(FirebaseFirestoreService.name);

  constructor(
    private readonly admin: FirebaseAdminService,
    private readonly config: ConfigService,
  ) {}

  dataStore(): 'postgres' | 'firestore' {
    const v = this.config.get<string>('DATA_STORE') ?? 'postgres';
    return v === 'firestore' ? 'firestore' : 'postgres';
  }

  isLive(): boolean {
    return this.admin.isConfigured();
  }

  async upsert(
    collection: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isLive()) return;
    try {
      await this.admin.firestore().collection(collection).doc(id).set(
        { ...data, updatedAt: new Date().toISOString() },
        { merge: true },
      );
    } catch (err) {
      this.logger.error(`Firestore upsert ${collection}/${id} failed: ${String(err)}`);
    }
  }

  async writeRestaurant(id: string, data: Record<string, unknown>) {
    await this.upsert(FIRESTORE_COLLECTIONS.restaurants, id, data);
  }

  async writeBranch(id: string, data: Record<string, unknown>) {
    await this.upsert(FIRESTORE_COLLECTIONS.branches, id, data);
  }

  async writeUser(id: string, data: Record<string, unknown>) {
    const { passwordHash: _p, pinHash: _pin, ...safe } = data;
    await this.upsert(FIRESTORE_COLLECTIONS.users, id, safe);
  }

  async writeImageMeta(id: string, data: Record<string, unknown>) {
    await this.upsert(FIRESTORE_COLLECTIONS.images, id, data);
  }

  async writeAudit(id: string, data: Record<string, unknown>) {
    await this.upsert(FIRESTORE_COLLECTIONS.auditLogs, id, data);
  }

  /**
   * Trusted financial writes. Callers must already have authorized the user.
   * Uses a transaction when Firestore is live; otherwise no-op (Postgres path).
   */
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T | null> {
    if (!this.isLive()) return null;
    let attempt = 0;
    const max = 5;
    while (attempt < max) {
      try {
        return await this.admin.firestore().runTransaction(fn);
      } catch (err) {
        attempt += 1;
        this.logger.warn(`Firestore transaction retry ${attempt}: ${String(err)}`);
        if (attempt >= max) throw err;
      }
    }
    return null;
  }
}
