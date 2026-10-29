import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { FirebaseFirestoreService } from '../../firebase/firebase-firestore.service';

export type ImgbbUploadResult = {
  url: string;
  deleteUrl?: string;
  width?: number;
  height?: number;
  stored: 'imgbb' | 'local';
};

@Injectable()
export class ImgbbService {
  private readonly logger = new Logger(ImgbbService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly firestore: FirebaseFirestoreService,
  ) {}

  apiKey(): string | undefined {
    const key = this.config.get<string>('IMGBB_API_KEY');
    return key && key.trim().length > 0 ? key.trim() : undefined;
  }

  async uploadPublicImage(params: {
    filePath: string;
    filename: string;
    restaurantId: string;
    branchId?: string;
    kind: 'menu' | 'logo' | 'category';
    localUrl: string;
  }): Promise<ImgbbUploadResult> {
    const key = this.apiKey();
    if (!key) {
      this.logger.warn(
        'IMGBB_API_KEY unset — storing image on local disk. See docs/IMGBB_SETUP.md',
      );
      return { url: params.localUrl, stored: 'local' };
    }

    const buf = readFileSync(params.filePath);
    const form = new FormData();
    form.set('key', key);
    form.set('image', buf.toString('base64'));
    form.set('name', params.filename.replace(/\.[^.]+$/, ''));

    const res = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: form,
    });
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        url?: string;
        display_url?: string;
        delete_url?: string;
        width?: number;
        height?: number;
      };
      error?: { message?: string };
    };

    if (!res.ok || !json.success || !json.data?.url) {
      throw new BadRequestException(
        json.error?.message ?? 'ImgBB upload failed',
      );
    }

    try {
      unlinkSync(params.filePath);
    } catch {
      // local copy is best-effort once ImgBB has the bytes
    }

    const url = json.data.display_url ?? json.data.url;
    const imageId = randomUUID();
    await this.firestore.writeImageMeta(imageId, {
      restaurantId: params.restaurantId,
      branchId: params.branchId ?? null,
      kind: params.kind,
      url,
      deleteUrl: json.data.delete_url ?? null,
      width: json.data.width ?? null,
      height: json.data.height ?? null,
    });

    return {
      url,
      deleteUrl: json.data.delete_url,
      width: json.data.width,
      height: json.data.height,
      stored: 'imgbb',
    };
  }
}
