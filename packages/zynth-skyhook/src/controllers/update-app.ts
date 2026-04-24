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
import { loadSnapshot, saveSnapshot } from "../storage/snapshots.js";
import { generateRequestSchema } from "../schemas/generate.js";
import type { GenerateRequest } from "../types/generate.js";
import { formatIssues, validate } from "../validation/valibot.js";
import { provisionDockerSandbox } from "../utils/docker-sandbox.js";

// This controller handles updating an existing app.
export const updateAppHandler = async (c: Context) => {
  const appId = c.req.param("appId");

  // 1. Validation (similar to generate, but appId is from URL param)
  let payload: GenerateRequest; // Reuse generateRequestSchema for prompt, but appId is from URL
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

  const prompt = payload.prompt.trim();
  const requestId = randomUUID();
  const agentRunId = randomUUID();

  try {
    // Ensure the app exists
    const existingApp = await db.select().from(apps).where(eq(apps.id, appId));
    if (existingApp.length === 0) {
      return c.json({ error: "App not found" }, 404);
    }

    const model =
      process.env.OPENROUTER_MODEL ?? "mistralai/devstral-2512:free";

    await db.insert(generationRequests).values({
      id: requestId,
      prompt,
      appId: appId,
      status: "pending",
    });

    await db.insert(agentRuns).values({
      id: agentRunId,
      appId: appId,
      requestId,
      status: "queued",
      llmModel: model,
      currentStep: "initializing",
    });

    // 2. Workspace Preparation: Load existing app from MinIO
    await updateRunStep(agentRunId, "loading_snapshot");
    const snapshot = await loadSnapshot({ appId, runId: "latest" }); // Assuming a "latest" snapshot or similar for update
    // TODO: Determine how to get the 'runId' for the latest snapshot to load.
    // For now, I'll use a placeholder 'latest'. This might need to be resolved
    // by querying agentRuns table for the last successful run for this appId.

    if (!snapshot) {
      return c.json({ error: "No existing app snapshot found" }, 404);
    }

    const workspaceRoot =
      process.env.SKYHOOK_WORKSPACES_DIR ??
      join(tmpdir(), "skyhook-workspaces");
    await mkdir(workspaceRoot, { recursive: true });
    const runDir = await mkdtemp(join(workspaceRoot, `run-${agentRunId}-`));
    const workspacePath = join(runDir, "workspace");
    await mkdir(workspacePath, { recursive: true });

    // Extract the snapshot to workspacePath
    await new Promise<void>((resolve, reject) => {
      const untar = spawn("tar", ["-xzf", "-"], { cwd: workspacePath });
      untar.stderr.on("data", (d) =>
        console.error(`[skyhook] untar stderr: ${d}`)
      );
      untar.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Untar failed with code ${code}`));
      });
      snapshot.stream.pipe(untar.stdin);
    });

    // 3. Artifacts Preparation (same as generate)
    await updateRunStep(agentRunId, "provisioning_artifacts");
    const stagedArtifacts = await ensureSharedArtifacts();
    const firstPath = Object.values(stagedArtifacts)[0];
    const sharedArtifactsRoot = firstPath ? join(firstPath, "..") : undefined;

    if (!sharedArtifactsRoot) {
      throw new Error("Failed to resolve shared artifacts root");
    }

    const dockerArtifactsRoot = "/opt/zynth-artifacts";
    const packageJsonPath = join(workspacePath, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));

    if (!packageJson.dependencies) packageJson.dependencies = {};

    for (const pkgName of Object.keys(stagedArtifacts)) {
      const folderName = pkgName.replace("@zynthjs/", "zynth-");
      packageJson.dependencies[pkgName] = `file:${join(
        dockerArtifactsRoot,
        folderName
      )}`;
    }
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // 4. Docker Provisioning (same as generate)
    await updateRunStep(agentRunId, "provisioning_sandbox");
    const sandbox = await provisionDockerSandbox({
      agentRunId,
      workspacePath,
      artifactsPath: sharedArtifactsRoot,
    });

    // 5. Run Goose Agent (same as generate)
    await updateRunStep(agentRunId, "running_agent");
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

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

    const runResult = await runGooseAgent({
      containerId: sandbox.sandboxId,
      prompt: combinedPrompt,
      openRouterApiKey: apiKey,
      model,
      workdir: "/app/workspace",
    });

    // Upload logs to MinIO/S3
    const logsUrl = await uploadAgentLogs({
      agentRunId,
      projectId: appId,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
    });

    const succeeded = runResult.exitCode === 0;

    let snapshotUrl: string | undefined;
    if (succeeded) {
      // 6. Save new snapshot
      await updateRunStep(agentRunId, "saving_snapshot");
      const tar = spawn("tar", ["-czf", "-", "-C", workspacePath, "."]);
      tar.stderr.on("data", (d) => console.error(`[skyhook] tar stderr: ${d}`));

      const snapshot = await saveSnapshot({
        appId: appId,
        runId: agentRunId,
        body: tar.stdout,
      });
      snapshotUrl = snapshot.url;
    }

    // 7. Update DB & Return
    await db
      .update(agentRuns)
      .set({
        status: succeeded ? "succeeded" : "failed",
        currentStep: "completed",
        sandboxId: sandbox.sandboxId,
        runner: "goose",
        workspacePath,
        artifactsPath: sharedArtifactsRoot,
        startedAt: new Date(),
        completedAt: new Date(),
        runnerCommand: "goose run ...",
        runnerExitCode: runResult.exitCode,
        runnerStdout: runResult.stdout,
        runnerStderr: runResult.stderr,
        runnerLogsUrl: logsUrl,
        errorMessage: succeeded
          ? null
          : `Goose exited with code ${runResult.exitCode}`,
      })
      .where(eq(agentRuns.id, agentRunId));

    await db
      .update(generationRequests)
      .set({
        status: succeeded ? "succeeded" : "failed",
        errorMessage: succeeded ? null : `agent run failed (id=${agentRunId})`,
      })
      .where(eq(generationRequests.id, requestId));

    return c.json(
      {
        requestId,
        agentRunId,
        status: succeeded ? "succeeded" : "failed",
        step: "completed",
        message: succeeded
          ? "Goose agent completed successfully."
          : "Goose agent failed.",
        prompt,
        appId: appId,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[skyhook] App update failed: ${message}`);

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

    return c.json({ error: "App update failed", details: message }, 500);
  }
};

async function updateRunStep(runId: string, step: string) {
  await db
    .update(agentRuns)
    .set({ currentStep: step })
    .where(eq(agentRuns.id, runId));
}
