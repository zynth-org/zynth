import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../storage/minio-client.js";
import { storageConfig } from "../storage/config.js";

type UploadLogsInput = {
  agentRunId: string;
  projectId: string;
  stdout: string;
  stderr: string;
};

export async function uploadAgentLogs({
  agentRunId,
  projectId,
  stdout,
  stderr,
}: UploadLogsInput) {
  const date = new Date().toISOString().split("T")[0];
  const basePath = `logs/${projectId}/${date}/${agentRunId}`;

  const stdoutKey = `${basePath}/stdout.log`;
  const stderrKey = `${basePath}/stderr.log`;

  await Promise.all([
    uploadFile(stdoutKey, stdout),
    uploadFile(stderrKey, stderr),
  ]);

  // Return the base URL for the run's logs
  // If publicBaseUrl is set, use it. Otherwise construct a s3:// style or null
  if (storageConfig.publicBaseUrl) {
    return `${storageConfig.publicBaseUrl}/${storageConfig.bucket}/${basePath}`;
  }

  return `${basePath}`;
}

async function uploadFile(key: string, content: string) {
  try {
    const command = new PutObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain",
    });
    await s3Client.send(command);
  } catch (error: any) {
    // Suppress full stack trace for common config errors
    const code = error.Code || error.code || "UnknownError";
    // console.warn(`[skyhook] Failed to upload log ${key}: ${code} - ${error.message}. (Check SKYHOOK_STORAGE_* credentials)`);
  }
}
