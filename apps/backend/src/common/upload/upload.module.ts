import { Global, Module } from '@nestjs/common';
import { ImgbbService } from './imgbb.service';

@Global()
@Module({
  providers: [ImgbbService],
  exports: [ImgbbService],
})
export class UploadModule {}
