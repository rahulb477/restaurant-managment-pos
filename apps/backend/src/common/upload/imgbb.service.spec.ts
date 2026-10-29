import { ImgbbService } from './imgbb.service';

describe('ImgbbService', () => {
  it('returns local URL when IMGBB_API_KEY is missing', async () => {
    const service = new ImgbbService(
      { get: () => undefined } as never,
      { writeImageMeta: jest.fn() } as never,
    );
    const result = await service.uploadPublicImage({
      filePath: '/tmp/nope',
      filename: 'a.jpg',
      restaurantId: 'r1',
      kind: 'menu',
      localUrl: '/api/uploads/a.jpg',
    });
    expect(result.stored).toBe('local');
    expect(result.url).toBe('/api/uploads/a.jpg');
  });

  it('does not expose the API key on the result object', async () => {
    const service = new ImgbbService(
      { get: () => 'secret-key' } as never,
      { writeImageMeta: jest.fn().mockResolvedValue(undefined) } as never,
    );
    expect(service.apiKey()).toBe('secret-key');
    const keys = Object.keys(await Promise.resolve({ url: 'x', stored: 'local' }));
    expect(keys).not.toContain('key');
  });
});
