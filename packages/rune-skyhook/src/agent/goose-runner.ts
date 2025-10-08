import { createDockerClient } from "../sandbox/docker-client.js";

type RunGooseInput = {
  containerId: string;
  prompt: string;
  openRouterApiKey: string;
  model?: string; // e.g. "openai/gpt-4o"
  env?: Record<string, string>;
  workdir?: string;
};

type RunGooseResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runGooseAgent({
  containerId,
  prompt,
  openRouterApiKey,
  model = "mistralai/devstral-2512:free",
  env = {},
  workdir = "/app/workspace",
}: RunGooseInput): Promise<RunGooseResult> {
  const docker = createDockerClient();
  const container = docker.getContainer(containerId);

  // 1. Ensure goose is installed
  // The official script installs to ~/.local/bin by default.
  // We check that path explicitly since PATH might not be updated in non-interactive exec.
  const goosePath = "/root/.local/bin/goose";

  const checkInstalled = await execCommand(
    container,
    [goosePath, "--version"],
    [],
    workdir
  );
  if (checkInstalled.exitCode !== 0) {
    console.log(
      `[skyhook] Installing goose in container ${containerId.slice(0, 12)}...`
    );

    // Ubuntu/Debian: apt-get

    await execCommand(container, ["apt-get", "update"], [], workdir);

    // 1. Core tools - Critical for downloading goose

    const coreResult = await execCommand(
      container,
      ["apt-get", "install", "-y", "curl", "bash", "ca-certificates", "bzip2"],
      [],
      workdir
    );

    if (coreResult.exitCode !== 0) {
      console.error(
        `[skyhook] Failed to install core tools: ${coreResult.stderr}`
      );

      // We throw here because without curl we can't do anything

      throw new Error("Failed to install curl/bash");
    }

    // 2. Libraries - Needed for running goose (headless/gui deps)

    // Ubuntu 24.04 uses libasound2t64

    const libsResult = await execCommand(
      container,
      [
        "apt-get",
        "install",
        "-y",
        "libxcb1",
        "libxkbcommon-x11-0",
        "xvfb",
        "libasound2t64",
        "libgbm1",
        "libnss3",
        "libnspr4",
      ],
      [],
      workdir
    );

    if (libsResult.exitCode !== 0) {
      console.warn(
        `[skyhook] Warning: Failed to install some libraries: ${libsResult.stderr}. Goose might fail to run.`
      );
    }

    const installCmd = [
      "sh",
      "-c",
      "curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash",
    ];

    const installResult = await execCommand(container, installCmd, [], workdir);
    if (installResult.exitCode !== 0) {
      throw new Error(`Failed to install goose: ${installResult.stderr}`);
    }
    console.log(`[skyhook] Goose installed.`);
  }

  // 2. Run Goose
  // We need to inject the env vars for OpenRouter
  // GOOSE_PROVIDER=openrouter
  // OPENROUTER_API_KEY=...
  // GOOSE_MODEL=...
  // GOOSE_MODE=auto (for headless)

  const gooseEnv = [
    `OPENROUTER_API_KEY=${openRouterApiKey}`,
    "GOOSE_PROVIDER=openrouter",
    `GOOSE_MODEL=${model}`,
    "GOOSE_MODE=auto",
    "GOOSE_CONTEXT_STRATEGY=summarize",
    "GOOSE_MAX_TURNS=50",
    // Add ~/.local/bin to PATH just in case
    `PATH=/root/.local/bin:${
      process.env.PATH ??
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    }`,
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
  ];

  // Construct the command
  // goose run --no-session --with-builtin developer -t "prompt"
  const cmd = [goosePath, "run", "--no-session", "--with-builtin", "developer", "-t", prompt];

  console.log(`[skyhook] Running goose agent: ${prompt}`);

  const result = await execCommand(container, cmd, gooseEnv, workdir);
  return result;
}

// Helper to execute exec and capture output
async function execCommand(
  container: any,
  Cmd: string[],
  Env: string[] = [],
  WorkingDir: string = "/app"
): Promise<RunGooseResult> {
  const exec = await container.exec({
    Cmd,
    Env,
    WorkingDir,
    AttachStdout: true,
    AttachStderr: true,
  });

  const stream = await exec.start({
    Tty: false,
    Detached: false,
  });

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
  console.log(`[skyhook] Goose stdout: ${stdout}`);
  if (stderr.length > 0) {
    console.log(`[skyhook] Goose stderr: ${stderr}`);
  }

  const inspect = await exec.inspect();
  return {
    exitCode: inspect.ExitCode ?? -1,
    stdout,
    stderr,
  };
}
