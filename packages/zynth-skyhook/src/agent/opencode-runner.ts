import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

type OpencodeEvent = {
  raw: string;
  parsed: unknown | null;
};

type RunOpencodeInput = {
  prompt: string;
  workspacePath: string;
  agentsMdPath: string;
  model?: string;
  agent?: string;
  extraEnv?: Record<string, string | undefined>;
};

type RunOpencodeResult = {
  runId: string;
  command: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: Date;
  completedAt: Date;
  stdout: string;
  stderr: string;
  events: OpencodeEvent[];
};

const DEFAULT_AGENT = "zynth-skyhook";

async function runOpencode({
  prompt,
  workspacePath,
  agentsMdPath,
  model,
  agent,
  extraEnv,
}: RunOpencodeInput): Promise<RunOpencodeResult> {
  const runId = randomUUID();
  const startedAt = new Date();

  const args = [
    "run",
    "--format",
    "json",
    "--file",
    agentsMdPath,
    "--agent",
    agent ?? process.env.SKYHOOK_OPENCODE_AGENT ?? DEFAULT_AGENT,
  ];

  const resolvedModel = model ?? process.env.SKYHOOK_OPENCODE_MODEL;
  if (resolvedModel) {
    args.push("--model", resolvedModel);
  }

  args.push(prompt);

  const command = ["opencode", ...args].join(" ");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_DISABLE_AUTOUPDATE: process.env.OPENCODE_DISABLE_AUTOUPDATE ?? "true",
    ...extraEnv,
  };

  const child = spawn("opencode", args, {
    cwd: workspacePath,
    env,
    stdio: "pipe",
  });

  const { stdout, stderr, events, exitCode, signal } = await collectChildOutput(child);
  const completedAt = new Date();

  return {
    runId,
    command,
    exitCode,
    signal,
    startedAt,
    completedAt,
    stdout,
    stderr,
    events,
  };
}

function collectChildOutput(child: ChildProcessWithoutNullStreams): Promise<{
  stdout: string;
  stderr: string;
  events: OpencodeEvent[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}> {
  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stdout = "";
    let stderr = "";
    const events: OpencodeEvent[] = [];

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutBuffer += text;

      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = stdoutBuffer.slice(0, newlineIndex).trimEnd();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          events.push({ raw: line, parsed: JSON.parse(line) });
        } catch {
          events.push({ raw: line, parsed: null });
        }
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      const tail = stdoutBuffer.trim();
      if (tail) {
        try {
          events.push({ raw: tail, parsed: JSON.parse(tail) });
        } catch {
          events.push({ raw: tail, parsed: null });
        }
      }

      resolve({
        stdout,
        stderr,
        events,
        exitCode: code,
        signal,
      });
    });
  });
}

export { runOpencode };
export type { OpencodeEvent, RunOpencodeInput, RunOpencodeResult };
