import { Global, Module } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseFirestoreService } from './firebase-firestore.service';
import { FirestoreMenuRepository } from './firestore-menu.repository';

@Global()
@Module({
  providers: [
    FirebaseAdminService,
    FirebaseAuthService,
    FirebaseFirestoreService,
    FirestoreMenuRepository,
  ],
  exports: [
    FirebaseAdminService,
    FirebaseAuthService,
    FirebaseFirestoreService,
    FirestoreMenuRepository,
  ],
})
export class FirebaseModule {}
