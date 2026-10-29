# ImgBB setup

Official API: `POST https://api.imgbb.com/1/upload`

## Key

1. Create an account at [imgbb.com](https://imgbb.com/).
2. Open [api.imgbb.com](https://api.imgbb.com/) and copy the API key.
3. Set **server-only**:

```
IMGBB_API_KEY=
```

Never use `NEXT_PUBLIC_IMGBB_API_KEY`. Never commit the key. Nest returns only `{ url, deleteHash?, width, height }` to the browser.

## Behaviour

- If `IMGBB_API_KEY` is set, menu item images and restaurant logos upload to ImgBB after MIME/size/signature checks.
- If the key is **unset**, uploads stay on local disk (`UPLOADS_DIR`) so the app does not silently break.
- Documents, Verifactu certificates, and backups are **not** sent to ImgBB (public hosting).

## Allowed use

Menu photos, category images, restaurant logos.

## Forbidden

Customer IDs, payment proofs, payroll, API keys, backups.

## Limits

Free ImgBB: typical 32 MB/image; this app still caps at 5 MB and jpg/png/webp/gif.
