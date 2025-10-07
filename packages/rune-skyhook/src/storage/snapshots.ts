import {
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandInput,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { s3Client } from "./minio-client.js";
import { storageConfig } from "./config.js";

type SnapshotLocation = {
  bucket: string;
  key: string;
  url?: string;
};

type SaveSnapshotInput = {
  projectId: string;
  runId: string;
  body: PutObjectCommandInput["Body"];
  contentType?: string;
  metadata?: Record<string, string>;
};

type LoadSnapshotInput = {
  projectId: string;
  runId: string;
};

type LoadedSnapshot = {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
};

const SNAPSHOT_FILENAME = "snapshot.zip";

const saveSnapshot = async ({
  projectId,
  runId,
  body,
  contentType = "application/zip",
  metadata,
}: SaveSnapshotInput): Promise<SnapshotLocation> => {
  const key = buildSnapshotKey(projectId, runId);

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

const loadSnapshot = async ({
  projectId,
  runId,
}: LoadSnapshotInput): Promise<LoadedSnapshot | null> => {
  const key = buildSnapshotKey(projectId, runId);

  try {
    const result = await s3Client.send(
      new GetObjectCommand({
        Bucket: storageConfig.bucket,
        Key: key,
      }),
    );

    const body = result.Body;

    if (!body || typeof (body as Readable).pipe !== "function") {
      throw new Error("[skyhook] Expected snapshot Body to be a readable stream.");
    }

    return {
      stream: body as Readable,
      contentType: result.ContentType,
      contentLength: result.ContentLength
        ? Number(result.ContentLength)
        : undefined,
      metadata: result.Metadata,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }

    throw error;
  }
};

const buildSnapshotKey = (projectId: string, runId: string) => {
  return `projects/${projectId}/runs/${runId}/${SNAPSHOT_FILENAME}`;
};

const isNotFound = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as { Code?: string; $metadata?: { httpStatusCode?: number } };

  return err.Code === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
};

export { buildSnapshotKey, loadSnapshot, saveSnapshot };
export type { LoadedSnapshot, SnapshotLocation };
