// Cloudflare R2 storage backend. R2 is S3-compatible, so we use the AWS SDK
// pointed at the R2 endpoint. Activated by STORAGE_BACKEND=r2 in .env.
//
// See docs/R2_SETUP.md for how to create the bucket + API token.

const config = require('../config');

let client = null;
function getClient() {
  if (client) return client;
  const { S3Client } = require('@aws-sdk/client-s3');
  const r2 = config.storage.r2;
  if (!r2.accountId || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
    throw new Error('R2 storage backend selected but R2_* env vars are not all set.');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
    },
  });
  return client;
}

async function put({ key, body, contentType }) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await getClient().send(new PutObjectCommand({
    Bucket: config.storage.r2.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return { key, contentType };
}

async function remove({ key }) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  await getClient().send(new DeleteObjectCommand({
    Bucket: config.storage.r2.bucket,
    Key: key,
  }));
}

function publicUrl(key) {
  if (!key) return null;
  // Pass-through eksterne URLer (brukes av seed-data / test-salonger).
  if (key.startsWith('http://') || key.startsWith('https://')) return key;
  // R2 public bucket URL or custom-domain URL — set via R2_PUBLIC_BASE_URL.
  // Example: https://media.nailed.no
  const base = config.storage.r2.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/${key}`;
}

module.exports = { id: 'r2', put, remove, publicUrl };
