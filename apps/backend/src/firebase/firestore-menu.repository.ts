import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { domainOnFirestore } from './domain-flags';
import {
  FIRESTORE_COLLECTIONS,
  FirebaseFirestoreService,
} from './firebase-firestore.service';
import { assertSameRestaurant } from './trusted-order-engine';

@Injectable()
export class FirestoreMenuRepository {
  constructor(
    private readonly firestore: FirebaseFirestoreService,
    private readonly config: ConfigService,
  ) {}

  enabled(): boolean {
    return domainOnFirestore(
      'menu',
      this.config.get<string>('FIRESTORE_DOMAINS'),
    );
  }

  async mirrorCategory(params: {
    id: string;
    restaurantId: string;
    branchId: string;
    data: Record<string, unknown>;
  }) {
    if (!this.enabled()) return;
    await this.firestore.upsert(FIRESTORE_COLLECTIONS.menuCategories, params.id, {
      restaurantId: params.restaurantId,
      branchId: params.branchId,
      ...params.data,
    });
  }

  async mirrorItem(params: {
    id: string;
    restaurantId: string;
    branchId: string;
    data: Record<string, unknown>;
  }) {
    if (!this.enabled()) return;
    await this.firestore.upsert(FIRESTORE_COLLECTIONS.menuItems, params.id, {
      restaurantId: params.restaurantId,
      branchId: params.branchId,
      ...params.data,
    });
  }

  assertOwner(actorRestaurantId: string, rowRestaurantId: string) {
    assertSameRestaurant(actorRestaurantId, rowRestaurantId);
  }
}
