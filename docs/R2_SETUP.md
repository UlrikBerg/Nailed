# Cloudflare R2 setup (~5 min)

In Fase 2 the storage backend defaults to `local` (writes to `./uploads/`). For production you'll
want object storage that survives deploys and scales. We use **Cloudflare R2** because it's
S3-compatible, has zero egress fees, and ~ø1/GB/month.

## 1. Create a Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with your email + password.
3. Verify the email Cloudflare sends.

(You don't need to add a domain to use R2.)

## 2. Activate R2

1. In the dashboard left menu, find **R2** → click it.
2. First-time activation prompts for billing info — R2 has a generous free tier (10 GB storage,
   1 million reads/month) but a credit card is still required to verify the account.
3. Accept the terms.

## 3. Create the bucket

1. **R2 Object Storage** → **Create bucket**
2. Name: `nailed-media` (must be globally unique on your account)
3. Location: **EU** (Norway is closest; pick "Eastern Europe" or "Western Europe").
4. **Create**.

## 4. Make the bucket publicly readable

Salon images need to be served from public URLs.

**Option A — quick (use an `r2.dev` subdomain):**
1. Open the bucket → **Settings** → **Public Access** → enable "Allow public access".
2. Cloudflare generates a URL like `https://pub-abc123.r2.dev/`.
3. Copy that URL — you'll set it as `R2_PUBLIC_BASE_URL` in `.env`.

**Option B — recommended (custom domain):**
1. Add a domain like `media.nailed.no` to Cloudflare DNS.
2. In R2 bucket → **Settings** → **Custom Domains** → **Connect Domain** → `media.nailed.no`.
3. Cloudflare provisions a TLS cert and CNAMEs for you.
4. Set `R2_PUBLIC_BASE_URL=https://media.nailed.no` in `.env`.

(You can start with Option A and switch later — only the env var changes.)

## 5. Create an API token

1. Top-right account menu → **My Profile** → **API Tokens** (or directly:
   https://dash.cloudflare.com/profile/api-tokens).
2. **Create Token** → use template **R2 Token**.
3. Permissions: **Object Read & Write** for the `nailed-media` bucket only (don't grant account-wide).
4. Click **Create Token**.
5. Cloudflare shows the **Access Key ID** and **Secret Access Key** **once**. Copy both.

## 6. Find your Account ID

In the R2 dashboard, the URL bar shows your account ID, or:
- **R2** → **Use R2 with APIs** (bottom of page)
- Endpoint will look like `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- The hex string before `.r2.cloudflarestorage.com` is your Account ID.

## 7. Set env vars

Edit `.env`:

```
STORAGE_BACKEND=r2
R2_ACCOUNT_ID=<account id from step 6>
R2_ACCESS_KEY_ID=<from step 5>
R2_SECRET_ACCESS_KEY=<from step 5>
R2_BUCKET=nailed-media
R2_PUBLIC_BASE_URL=https://pub-abc123.r2.dev   # or your custom domain
```

## 8. Restart the server

```bash
npm run dev
```

Try uploading a salon cover image from `/salong-panel.html`. It should appear in the bucket
(check Cloudflare dashboard → R2 → bucket → Objects).

## Switching back to local

Set `STORAGE_BACKEND=local` and restart. Existing R2 URLs remain valid (the database stores keys
independent of backend), but new uploads go to disk again. If you want to migrate already-uploaded
images, copy them between backends with the AWS CLI:

```bash
# Copy R2 → local
aws s3 sync s3://nailed-media ./uploads --endpoint-url=https://<account>.r2.cloudflarestorage.com
```

## Cost expectations

- Storage: ø1/GB/month after 10 GB free. 1000 salons × 24 photos × 0.5 MB = 12 GB ≈ ø2/month.
- Class A operations (writes): 1M/month free, then ø45/million.
- Class B operations (reads): 10M/month free, then ø3.6/million.
- **Egress: free.** This is the killer feature vs. AWS S3.

For nailed's expected scale, R2 will cost a few kroner per month for years.
