import type Docker from "dockerode";
import { Writable } from "node:stream";
import { createDockerClient } from "../utils/docker-client.js";

type BuildMode = "check" | "build";

type BuildRequest = {
  appId: string;
  runId: string;
  workspacePath: string;
  artifactsPath: string;
  mode: BuildMode;
};

type BuildResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const DEFAULT_CONCURRENCY = 4;
const queue: Array<{
  request: BuildRequest;
  resolve: (value: BuildResult) => void;
  reject: (error: Error) => void;
}> = [];
let activeCount = 0;

export async function runWorkspaceBuild(request: BuildRequest): Promise<BuildResult> {
  return enqueue(request);
}

function enqueue(request: BuildRequest): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    queue.push({ request, resolve, reject });
    void drainQueue();
  });
}

async function drainQueue() {
  const concurrency =
    Number.parseInt(process.env.SKYHOOK_BUILD_CONCURRENCY ?? "", 10) ||
    DEFAULT_CONCURRENCY;

  if (activeCount >= concurrency) return;
  const next = queue.shift();
  if (!next) return;

  activeCount += 1;
  try {
    const result = await runBuildNow(next.request);
    next.resolve(result);
  } catch (error) {
    next.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    activeCount -= 1;
    void drainQueue();
  }
}

async function runBuildNow({
  appId,
  workspacePath,
  artifactsPath,
  mode,
  runId,
}: BuildRequest): Promise<BuildResult> {
  const docker = createDockerClient();
  await pingDocker(docker);

  const image =
    process.env.SKYHOOK_BUILD_IMAGE ??
    process.env.SKYHOOK_SANDBOX_IMAGE ??
    "rune-skyhook-sandbox:latest";
  await ensureImage(docker, image);

  const workdir = process.env.SKYHOOK_BUILD_WORKDIR ?? "/app";
  const workspaceMountPath =
    process.env.SKYHOOK_BUILD_WORKSPACE_MOUNT ?? "/app/workspace";
  const artifactsMountPath =
    process.env.SKYHOOK_BUILD_ARTIFACTS_MOUNT ?? "/opt/rune-artifacts";
  const yarnCacheHostDir = process.env.SKYHOOK_BUILD_YARN_CACHE_DIR;
  const yarnCacheMountPath =
    process.env.SKYHOOK_BUILD_YARN_CACHE_MOUNT ?? "/opt/yarn-cache";

  const binds = [
    `${workspacePath}:${workspaceMountPath}`,
    `${artifactsPath}:${artifactsMountPath}:ro`,
  ];

  if (yarnCacheHostDir) {
    binds.push(`${yarnCacheHostDir}:${yarnCacheMountPath}`);
  }

  const buildCommand =
    mode === "check"
      ? "yarn install && yarn build"
      : "yarn install && yarn build";

  const env: string[] = [];
  if (yarnCacheHostDir) {
    env.push(`YARN_CACHE_FOLDER=${yarnCacheMountPath}`);
  }

  const containerName = `skyhook-build-${runId}`;
  const createOptions = {
    name: containerName,
    Image: image,
    WorkingDir: workspaceMountPath,
    Cmd: ["sh", "-lc", buildCommand],
    Env: env.length ? env : undefined,
    HostConfig: {
      Binds: binds,
      AutoRemove: true,
    },
    Labels: {
      "rune.skyhook": "true",
      "rune.skyhook.role": "build",
      "rune.skyhook.run_id": runId,
      "rune.skyhook.app_id": appId,
    },
  };

  const container = await docker.createContainer(createOptions);
  await container.start();

  const logStream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
  });

  let stdout = "";
  let stderr = "";

  await new Promise<void>((resolve, reject) => {
    const stdoutSink = new Writable({
      write(chunk, _encoding, callback) {
        stdout += chunk.toString("utf-8");
        callback();
      },
    });
    const stderrSink = new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString("utf-8");
        callback();
      },
    });

    docker.modem.demuxStream(logStream, stdoutSink, stderrSink);

    logStream.on("end", resolve);
    logStream.on("error", reject);
  });

  const result = await container.wait();
  return {
    exitCode: result.StatusCode ?? -1,
    stdout,
    stderr,
  };
}

async function pingDocker(docker: Docker) {
  try {
    await docker.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[skyhook] Failed to reach Docker daemon for build container. (${message})`,
    );
  }
}

async function ensureImage(docker: Docker, image: string) {
  try {
    const img = docker.getImage(image);
    await img.inspect();
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.log(`[skyhook] Build image ${image} not found locally, pulling...`);
      const stream = await docker.pull(image);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      });
      console.log(`[skyhook] Pulled ${image}`);
    } else {
      throw error;
    }
  }
}

export type { BuildMode, BuildRequest, BuildResult };
