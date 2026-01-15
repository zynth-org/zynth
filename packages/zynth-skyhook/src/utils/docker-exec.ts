import { createDockerClient } from "./docker-client.js";

type ExecInSandboxInput = {
  containerId: string;
  cmd: string[];
  env?: string[];
  workdir?: string;
};

type ExecInSandboxResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function execInSandbox({
  containerId,
  cmd,
  env = [],
  workdir = "/app",
}: ExecInSandboxInput): Promise<ExecInSandboxResult> {
  const docker = createDockerClient();
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: cmd,
    Env: env,
    WorkingDir: workdir,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = (await exec.start({
    Tty: false,
    Detach: false,
  })) as import("node:stream").Duplex;

  let stdout = "";
  let stderr = "";

  await new Promise((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      {
        write: (chunk: Buffer) => {
          stdout += chunk.toString("utf-8");
        },
      },
      {
        write: (chunk: Buffer) => {
          stderr += chunk.toString("utf-8");
        },
      }
    );

    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const inspect = await exec.inspect();
  return {
    exitCode: inspect.ExitCode ?? -1,
    stdout,
    stderr,
  };
}
