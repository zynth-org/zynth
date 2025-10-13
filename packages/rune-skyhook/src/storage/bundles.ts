import {
  PutObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { s3Client } from "./minio-client.js";
import { storageConfig } from "./config.js";

type BundleLocation = {
  bucket: string;
  key: string;
  url?: string;
};

type SaveBundleInput = {
  appId: string;
  runId: string;
  body: PutObjectCommandInput["Body"];
  contentType?: string;
  metadata?: Record<string, string>;
};

const BUNDLE_FILENAME = "bundle.tar.gz";

const saveBundle = async ({
  appId,
  runId,
  body,
  contentType = "application/gzip",
  metadata,
}: SaveBundleInput): Promise<BundleLocation> => {
  const key = buildBundleKey(appId, runId);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    }),
  );

  return {
    bucket: storageConfig.bucket,
    key,
    url: storageConfig.publicBaseUrl
      ? `${storageConfig.publicBaseUrl.replace(/\/+$/, "")}/${key}`
      : undefined,
  };
};

const buildBundleKey = (appId: string, runId: string) => {
  return `apps/${appId}/runs/${runId}/${BUNDLE_FILENAME}`;
};

export { buildBundleKey, saveBundle };
export type { BundleLocation };
