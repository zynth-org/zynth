import type Docker from "dockerode";
import type { ContainerCreateOptions } from "dockerode";
import { createDockerClient } from "./docker-client.js";

type ProvisionSandboxInput = {
  agentRunId: string;
  workspacePath: string;
  artifactsPath?: string;
};

type ProvisionSandboxResult = {
  sandboxId: string;
  containerName: string;
  image: string;
  artifactsMountPath?: string;
};

async function provisionDockerSandbox({
  agentRunId,
  workspacePath,
  artifactsPath,
}: ProvisionSandboxInput): Promise<ProvisionSandboxResult> {
  const docker = createDockerClient();
  await pingDocker(docker);

  const image =
    process.env.SKYHOOK_SANDBOX_IMAGE ?? "zynth-skyhook-sandbox:latest";

  await ensureImage(docker, image);

  const containerName = `skyhook-${agentRunId}`;
  const workdir = process.env.SKYHOOK_SANDBOX_WORKDIR ?? "/app";
  const workspaceMountPath =
    process.env.SKYHOOK_SANDBOX_WORKSPACE_MOUNT ?? "/app/workspace";
  const artifactsMountPath = "/opt/zynth-artifacts";

  const binds = [`${workspacePath}:${workspaceMountPath}`];
  if (artifactsPath) {
    // Mount artifacts as read-only
    binds.push(`${artifactsPath}:${artifactsMountPath}:ro`);
  }

  const createOptions: ContainerCreateOptions = {
    name: containerName,
    Image: image,
    WorkingDir: workdir,
    Cmd: ["sh", "-lc", "echo '[skyhook] sandbox ready' && sleep 3600"],
    Env: buildSandboxEnv(),
    HostConfig: {
      Binds: binds,
      AutoRemove: false,
    },
    Labels: {
      "zynth.skyhook": "true",
      "zynth.skyhook.agent_run_id": agentRunId,
    },
  };

  const container = await docker.createContainer(createOptions);
  await container.start();

  return {
    sandboxId: container.id,
    containerName,
    image,
    artifactsMountPath: artifactsPath ? artifactsMountPath : undefined,
  };
}

async function pingDocker(docker: Docker) {
  try {
    await docker.ping();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[skyhook] Failed to reach Docker daemon. Is Docker running and is the socket accessible? (${message})`
    );
  }
}

function buildSandboxEnv() {
  const env: string[] = [];
  const allowlist = (process.env.SKYHOOK_SANDBOX_ENV_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const key of allowlist) {
    const value = process.env[key];
    if (value === undefined) continue;
    env.push(`${key}=${value}`);
  }

  return env.length ? env : undefined;
}

async function ensureImage(docker: Docker, image: string) {
  try {
    const img = docker.getImage(image);
    await img.inspect();
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.log(`[skyhook] Image ${image} not found locally, pulling...`);
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

export { provisionDockerSandbox };
export type { ProvisionSandboxInput, ProvisionSandboxResult };
