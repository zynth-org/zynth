import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
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
import { generateRequestSchema } from "../schemas/generate.js";
import type { GenerateRequest } from "../types/generate.js";
import { formatIssues, validate } from "../validation/valibot.js";
import { provisionDockerSandbox } from "../utils/docker-sandbox.js";
import { runWorkspaceBuild } from "../dockport/build-runner.js";
import { saveBundle } from "../storage/bundles.js";

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
    console.log(`[skyhook] [${agentRunId}] Preparing workspace`);
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
    console.log(`[skyhook] [${agentRunId}] Preparing artifacts`);
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
    console.log(`[skyhook] [${agentRunId}] Provisioning agent sandbox`);
    await updateRunStep(agentRunId, "provisioning_sandbox");
    const sandbox = await provisionDockerSandbox({
      agentRunId,
      workspacePath,
    });

    // #endregion 5 — Docker Provisioning

    // #region 6 — Run Goose Agent (disabled) / Build Bundle
    // 6. Run Goose Agent (set to true to re-enable)
    const runAgent = process.env.SKYHOOK_RUN_AGENT === "true";
    const maxRetries = Math.max(
      0,
      Number.parseInt(process.env.SKYHOOK_BUILD_RETRIES ?? "5", 10) || 5
    );
    let runResult: { exitCode: number; stdout: string; stderr: string } | null =
      null;
    let logsUrl: string | undefined;
    let snapshotUrl: string | undefined;
    let buildResult: { exitCode: number; stdout: string; stderr: string } | null =
      null;
    let bundleUrl: string | undefined;
    let attempt = 0;

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

    while (true) {
      if (runAgent) {
        console.log(
          `[skyhook] [${agentRunId}] Running agent (attempt ${attempt + 1}/${maxRetries + 1})`
        );
        await updateRunStep(
          agentRunId,
          attempt === 0 ? "running_agent" : "retrying_agent"
        );
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          throw new Error("OPENROUTER_API_KEY is not configured.");
        }

        const errorContext =
          attempt > 0 && buildResult
            ? `\n\n# Build Failed\nExit code: ${buildResult.exitCode}\n\nSTDOUT:\n${buildResult.stdout}\n\nSTDERR:\n${buildResult.stderr}`
            : "";
        const combinedPrompt = `${bootstrapPrompt}\n\n# User Request\n${prompt}${errorContext}`;

        runResult = await runGooseAgent({
          containerId: sandbox.sandboxId,
          prompt: combinedPrompt,
          openRouterApiKey: apiKey,
          model,
          workdir: "/app/workspace",
        });
        console.log(
          `[skyhook] [${agentRunId}] Agent finished with exit code ${runResult.exitCode}`
        );

        logsUrl = await uploadAgentLogs({
          agentRunId,
          projectId: resolvedAppId,
          stdout: runResult.stdout,
          stderr: runResult.stderr,
        });

        if (runResult.exitCode !== 0) {
          break;
        }
      }

      await updateRunStep(agentRunId, "building_bundle");
      console.log(`[skyhook] [${agentRunId}] Starting build container`);
      buildResult = await runWorkspaceBuild({
        appId: resolvedAppId,
        runId: agentRunId,
        workspacePath,
        artifactsPath: sharedArtifactsRoot,
        mode: "build",
      });
      console.log(
        `[skyhook] [${agentRunId}] Build finished with exit code ${buildResult.exitCode}`
      );

      if (buildResult.exitCode === 0) {
        await updateRunStep(agentRunId, "saving_bundle");
        const tar = spawn("tar", [
          "-czf",
          "-",
          "-C",
          join(workspacePath, "dist"),
          ".",
        ]);
        tar.stderr.on("data", (d) => console.error(`[skyhook] tar stderr: ${d}`));

        const bundle = await saveBundle({
          appId: resolvedAppId,
          runId: agentRunId,
          body: tar.stdout,
        });
        bundleUrl = bundle.url;
        console.log(
          `[skyhook] [${agentRunId}] Bundle uploaded${bundleUrl ? `: ${bundleUrl}` : ""}`
        );
        break;
      }

      if (!runAgent || attempt >= maxRetries) {
        break;
      }

      attempt += 1;
      console.log(
        `[skyhook] [${agentRunId}] Build failed, retrying agent (attempt ${attempt + 1}/${maxRetries + 1})`
      );
      await rm(join(workspacePath, "node_modules"), {
        recursive: true,
        force: true,
      });
    }

    const primaryResult = buildResult ?? runResult;
    if (!primaryResult) {
      throw new Error("[skyhook] Build runner did not produce a result.");
    }
    const succeeded =
      (runAgent ? runResult?.exitCode === 0 : true) &&
      (buildResult ? buildResult.exitCode === 0 : runAgent);
    const runnerCommand = buildResult
      ? "yarn install && yarn build"
      : "goose run ...";
    const runnerName = buildResult ? "build-container" : "goose";
    const runnerMessage = buildResult
      ? buildResult.exitCode === 0
        ? "Build completed successfully."
        : "Build failed."
      : runResult?.exitCode === 0
        ? "Goose agent completed successfully."
        : "Goose agent failed.";

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
        runnerExitCode: primaryResult.exitCode,
        runnerStdout: primaryResult.stdout,
        runnerStderr: primaryResult.stderr,
        runnerLogsUrl: logsUrl,
        errorMessage: succeeded
          ? null
          : buildResult
            ? `Build exited with code ${primaryResult.exitCode}`
            : `Goose exited with code ${primaryResult.exitCode}`,
      })
      .where(eq(agentRuns.id, agentRunId));

    await db
      .update(generationRequests)
      .set({
        status: succeeded ? "succeeded" : "failed",
        errorMessage: succeeded
          ? null
          : buildResult
            ? `build failed (id=${agentRunId})`
            : `agent run failed (id=${agentRunId})`,
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
          stdout: primaryResult.stdout,
          stderr: primaryResult.stderr,
          exitCode: primaryResult.exitCode,
        },
        bundleUrl,
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
