import {
  FIRESTORE_COLLECTIONS,
  FirebaseFirestoreService,
} from './firebase-firestore.service';

describe('FirebaseFirestoreService', () => {
  it('defaults DATA_STORE to postgres', () => {
    const svc = new FirebaseFirestoreService(
      { isConfigured: () => false } as never,
      { get: () => undefined } as never,
    );
    expect(svc.dataStore()).toBe('postgres');
    expect(svc.isLive()).toBe(false);
  });

  it('strips password hashes before user upsert', async () => {
    const upserted: Record<string, unknown>[] = [];
    const svc = new FirebaseFirestoreService(
      { isConfigured: () => true } as never,
      { get: () => 'postgres' } as never,
    );
    svc.upsert = async (_c, _id, data) => {
      upserted.push(data);
    };
    await svc.writeUser('u1', {
      email: 'a@b.c',
      passwordHash: 'secret',
      pinHash: '1234',
      name: 'A',
    });
    expect(upserted[0]).toMatchObject({ email: 'a@b.c', name: 'A' });
    expect(upserted[0].passwordHash).toBeUndefined();
    expect(upserted[0].pinHash).toBeUndefined();
  });

  it('documents collection names used by the adapter', () => {
    expect(FIRESTORE_COLLECTIONS.orders).toBe('orders');
    expect(FIRESTORE_COLLECTIONS.kitchenTickets).toBe('kitchenTickets');
  });
});
