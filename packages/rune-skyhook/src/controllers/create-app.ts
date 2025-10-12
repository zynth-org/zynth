import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentRuns, generationRequests, apps } from "../db/schema.js";
import {
  createProjectWorkspace,
  ensureSharedArtifacts,
} from "../services/provisioning.js";
import { uploadAgentLogs } from "../services/logs.js";
import { runGooseAgent } from "../agent/goose-runner.js";
import { saveSnapshot } from "../storage/snapshots.js";
import { generateRequestSchema } from "../schemas/generate.js";
import type { GenerateRequest } from "../types/generate.js";
import { formatIssues, validate } from "../validation/valibot.js";
import { provisionDockerSandbox } from "../utils/docker-sandbox.js";
import { execInSandbox } from "../utils/docker-exec.js";

export const createAppHandler = async (c: Context) => {
  // #region 1 — Validation
  // 1. Validation
  let payload: GenerateRequest;
  try {
    const json = await c.req.json<unknown>();
    const result = validate(generateRequestSchema, json);
    if (!result.ok) {
      return c.json(
        { error: "Invalid request body", issues: formatIssues(result.issues) },
        400
      );
    }
    payload = result.value;
  } catch (error) {
    return c.json({ error: "Invalid JSON body", details: String(error) }, 400);
  }
  // #endregion 1 — Validation

  const prompt = payload.prompt.trim();
  const appId = payload.appId?.trim() || null;
  const requestId = randomUUID();
  const agentRunId = randomUUID();

  try {
    // #region 2 — Resolve App & Persistence
    // 2. Resolve App & Persistence
    const resolvedAppId = await resolveAppId({ appId, prompt });
    if (!resolvedAppId) return c.json({ error: "Failed to resolve app" }, 500);

    const model =
      process.env.OPENROUTER_MODEL ?? "mistralai/devstral-2512:free";

    await db.insert(generationRequests).values({
      id: requestId,
      prompt,
      appId: resolvedAppId,
      status: "pending",
    });

    await db.insert(agentRuns).values({
      id: agentRunId,
      appId: resolvedAppId,
      requestId,
      status: "queued",
      llmModel: model,
      currentStep: "initializing",
    });
    // #endregion 2 — Resolve App & Persistence

    // #region 3 — Workspace Preparation
    // 3. Workspace Preparation
    await updateRunStep(agentRunId, "provisioning_workspace");
    const workspaceRoot =
      process.env.SKYHOOK_WORKSPACES_DIR ??
      join(tmpdir(), "skyhook-workspaces");
    await mkdir(workspaceRoot, { recursive: true });

    // Create unique dirs for this run
    const runDir = await mkdtemp(join(workspaceRoot, `run-${agentRunId}-`));
    const workspacePath = join(runDir, "workspace");
    // const artifactsPath = join(runDir, "artifacts"); // REMOVED

    // Copy templates
    await createProjectWorkspace(workspacePath, {
      name: deriveAppName(prompt),
      slug: `app-${resolvedAppId.slice(0, 8)}`,
    });

    // #endregion 3 — Workspace Preparation

    // #region 4 — Artifacts Preparation
    // 4. Artifacts Preparation
    await updateRunStep(agentRunId, "provisioning_artifacts");
    const stagedArtifacts = await ensureSharedArtifacts();

    // Determine the root of the shared artifacts to mount
    // We assume all artifacts are under the same root
    const firstPath = Object.values(stagedArtifacts)[0];
    const sharedArtifactsRoot = firstPath ? join(firstPath, "..") : undefined;

    if (!sharedArtifactsRoot) {
      throw new Error("Failed to resolve shared artifacts root");
    }

    // Link artifacts in package.json
    // We map the local artifacts path to the Docker mount path: /opt/rune-artifacts
    const dockerArtifactsRoot = "/opt/rune-artifacts";
    const packageJsonPath = join(workspacePath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    if (!packageJson.dependencies) packageJson.dependencies = {};
    delete packageJson.resolutions;

    for (const pkgName of Object.keys(stagedArtifacts)) {
      // e.g. pkgName = @rune/core
      // folderName = rune-core
      const folderName = pkgName.replace("@rune/", "rune-");
      const artifactPath = `file:${join(dockerArtifactsRoot, folderName)}`;
      packageJson.dependencies[pkgName] = artifactPath;
    }

    // Drop @rune/* deps that aren't staged to avoid registry lookups in the sandbox.
    for (const section of ["dependencies", "devDependencies"] as const) {
      const deps = packageJson[section];
      if (!deps) continue;
      for (const depName of Object.keys(deps)) {
        if (!depName.startsWith("@rune/")) continue;
        if (stagedArtifacts[depName]) continue;
        delete deps[depName];
      }
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // #endregion 4 — Artifacts Preparation

    // #region 5 — Docker Provisioning
    // 5. Docker Provisioning
    await updateRunStep(agentRunId, "provisioning_sandbox");
    const sandbox = await provisionDockerSandbox({
      agentRunId,
      workspacePath,
      artifactsPath: sharedArtifactsRoot,
    });

    // #endregion 5 — Docker Provisioning

    // #region 6 — Run Goose Agent (disabled) / Build Bundle
    // 6. Run Goose Agent (set to true to re-enable)
    const runAgent = false;
    let runResult: { exitCode: number; stdout: string; stderr: string };
    let logsUrl: string | undefined;
    let snapshotUrl: string | undefined;

    if (runAgent) {
      await updateRunStep(agentRunId, "running_agent");
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is not configured.");
      }

      // Prepare Prompt
      const bootstrapPromptPath = join(
        process.cwd(),
        "src/agent/prompts/bootstrap.md"
      );
      let bootstrapPrompt = "";
      try {
        bootstrapPrompt = await readFile(bootstrapPromptPath, "utf-8");
      } catch (e) {
        console.warn(
          `[skyhook] Failed to load bootstrap prompt from ${bootstrapPromptPath}`,
          e
        );
      }

      const combinedPrompt = `${bootstrapPrompt}\n\n# User Request\n${prompt}`;

      runResult = await runGooseAgent({
        containerId: sandbox.sandboxId,
        prompt: combinedPrompt,
        openRouterApiKey: apiKey,
        model,
        workdir: "/app/workspace",
      });

      // Upload logs to MinIO/S3
      logsUrl = await uploadAgentLogs({
        agentRunId,
        projectId: resolvedAppId,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
      });

      if (runResult.exitCode === 0) {
        // #region 7 — Save Snapshot
        // 7. Save Snapshot
        await updateRunStep(agentRunId, "saving_snapshot");
        const tar = spawn("tar", ["-czf", "-", "-C", workspacePath, "."]);

        // We don't await the tar process exit explicitly, the stream consumption by S3 should handle it?
        // But it's safer to handle errors.
        tar.stderr.on("data", (d) => console.error(`[skyhook] tar stderr: ${d}`));

        const snapshot = await saveSnapshot({
          appId: resolvedAppId,
          runId: agentRunId,
          body: tar.stdout,
        });
        snapshotUrl = snapshot.url;
        // #endregion 7 — Save Snapshot
      }
    } else {
      await updateRunStep(agentRunId, "building_bundle");
      runResult = await execInSandbox({
        containerId: sandbox.sandboxId,
        cmd: ["sh", "-lc", "yarn install && yarn build"],
        workdir: "/app/workspace",
      });
    }

    const succeeded = runResult.exitCode === 0;
    const runnerCommand = runAgent
      ? "goose run ..."
      : "yarn install && yarn build";
    const runnerName = runAgent ? "goose" : "yarn-build";
    const runnerMessage = runAgent
      ? succeeded
        ? "Goose agent completed successfully."
        : "Goose agent failed."
      : succeeded
        ? "Build completed successfully."
        : "Build failed.";

    // #region 8 — Update DB & Return
    // 8. Update DB & Return
    await db
      .update(agentRuns)
      .set({
        status: succeeded ? "succeeded" : "failed",
        currentStep: "completed",
        sandboxId: sandbox.sandboxId,
        runner: runnerName,
        workspacePath,
        artifactsPath: sharedArtifactsRoot,
        startedAt: new Date(),
        completedAt: new Date(),
        runnerCommand,
        runnerExitCode: runResult.exitCode,
        runnerStdout: runResult.stdout,
        runnerStderr: runResult.stderr,
        runnerLogsUrl: logsUrl,
        errorMessage: succeeded
          ? null
          : runAgent
            ? `Goose exited with code ${runResult.exitCode}`
            : `Build exited with code ${runResult.exitCode}`,
      })
      .where(eq(agentRuns.id, agentRunId));

    await db
      .update(generationRequests)
      .set({
        status: succeeded ? "succeeded" : "failed",
        errorMessage: succeeded
          ? null
          : runAgent
            ? `agent run failed (id=${agentRunId})`
            : `build failed (id=${agentRunId})`,
      })
      .where(eq(generationRequests.id, requestId));

    return c.json(
      {
        requestId,
        agentRunId,
        status: succeeded ? "succeeded" : "failed",
        step: "completed",
        message: runnerMessage,
        prompt,
        appId: resolvedAppId,
        workspacePath,
        sandbox,
        artifactsMountPath: sandbox.artifactsMountPath,
        snapshotUrl,
        runner: {
          stdout: runResult.stdout,
          stderr: runResult.stderr,
          exitCode: runResult.exitCode,
        },
      },
      succeeded ? 200 : 500
    );
    // #endregion 8 — Update DB & Return
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[skyhook] Generation failed: ${message}`);

    await db
      .update(agentRuns)
      .set({
        status: "failed",
        errorMessage: message,
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRunId));

    await db
      .update(generationRequests)
      .set({ status: "failed", errorMessage: message })
      .where(eq(generationRequests.id, requestId));

    return c.json({ error: "Generation failed", details: message }, 500);
  }
};

// --- Helpers ---

async function resolveAppId({
  appId,
  prompt,
}: {
  appId: string | null;
  prompt: string;
}) {
  if (appId) {
    const existing = await db
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.id, appId));
    return existing.length ? appId : null;
  }
  const id = randomUUID();
  const [created] = await db
    .insert(apps)
    .values({ id, name: deriveAppName(prompt) })
    .returning();
  return created?.id ?? null;
}

function deriveAppName(prompt: string) {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 30
    ? `${trimmed.slice(0, 27)}...`
    : trimmed || "Untitled App";
}

async function updateRunStep(runId: string, step: string) {
  await db
    .update(agentRuns)
    .set({ currentStep: step })
    .where(eq(agentRuns.id, runId));
}
