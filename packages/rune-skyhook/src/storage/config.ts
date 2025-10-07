type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  publicBaseUrl?: string;
};

const storageConfig = resolveStorageConfig();

function resolveStorageConfig(): StorageConfig {
  const bucket = process.env.SKYHOOK_STORAGE_BUCKET;
  const accessKey = process.env.SKYHOOK_STORAGE_ACCESS_KEY;
  const secretKey = process.env.SKYHOOK_STORAGE_SECRET_KEY;

  if (!bucket || !bucket.trim()) {
    throw new Error("[skyhook] SKYHOOK_STORAGE_BUCKET is required for MinIO/S3 storage.");
  }

  if (!accessKey || !secretKey) {
    throw new Error(
      "[skyhook] SKYHOOK_STORAGE_ACCESS_KEY and SKYHOOK_STORAGE_SECRET_KEY are required for MinIO/S3 storage.",
    );
  }

  const endpoint =
    process.env.SKYHOOK_STORAGE_ENDPOINT?.trim() || "http://127.0.0.1:9000";
  const region = process.env.SKYHOOK_STORAGE_REGION?.trim() || "us-east-1";
  const forcePathStyle =
    process.env.SKYHOOK_STORAGE_FORCE_PATH_STYLE !== "false";
  const publicBaseUrl = process.env.SKYHOOK_STORAGE_PUBLIC_BASE_URL?.trim();

  return {
    endpoint,
    region,
    bucket,
    accessKey,
    secretKey,
    forcePathStyle,
    publicBaseUrl,
  };
}

export { storageConfig };
export type { StorageConfig };
