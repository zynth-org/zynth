import { S3Client } from "@aws-sdk/client-s3";
import { storageConfig } from "./config.js";

const s3Client = new S3Client({
  region: storageConfig.region,
  endpoint: storageConfig.endpoint,
  forcePathStyle: storageConfig.forcePathStyle,
  credentials: {
    accessKeyId: storageConfig.accessKey,
    secretAccessKey: storageConfig.secretKey,
  },
});

export { s3Client };
