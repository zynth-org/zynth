import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { agentRuns, generationRequests, projects } from "../db/schema.js";
import {
  createProjectWorkspace,
  ensureSharedArtifacts,
} from "../services/provisioning.js";
import { uploadAgentLogs } from "../services/logs.js";
import { provisionDockerSandbox } from "../sandbox/docker-sandbox.js";
import { runGooseAgent } from "../agent/goose-runner.js";
import { generateRequestSchema } from "../schemas/generate.js";
import type { GenerateRequest } from "../types/generate.js";
import { formatIssues, validate } from "../validation/valibot.js";

export const postGenerateRequest = async (c: Context) => {
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

  const prompt = payload.prompt.trim();
  const projectId = payload.projectId?.trim() || null;
  const requestId = randomUUID();
  const agentRunId = randomUUID();

  try {
    // 2. Resolve Project & Persistence
    const resolvedProjectId = await resolveProjectId({ projectId, prompt });
    if (!resolvedProjectId)
      return c.json({ error: "Failed to resolve project" }, 500);

    const model =
      process.env.OPENROUTER_MODEL ?? "mistralai/devstral-2512:free";

    await db.insert(generationRequests).values({
      id: requestId,
      prompt,
      projectId: resolvedProjectId,
      status: "pending",
    });

    await db.insert(agentRuns).values({
      id: agentRunId,
      projectId: resolvedProjectId,
      requestId,
      status: "queued",
      llmModel: model,
      currentStep: "initializing",
    });

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
      name: deriveProjectName(prompt),
      slug: `project-${resolvedProjectId.slice(0, 8)}`,
    });

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

    for (const pkgName of Object.keys(stagedArtifacts)) {
      // e.g. pkgName = @rune/core
      // folderName = rune-core
      const folderName = pkgName.replace("@rune/", "rune-");
      packageJson.dependencies[pkgName] = `file:${join(
        dockerArtifactsRoot,
        folderName
      )}`;
    }

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // 5. Docker Provisioning
    await updateRunStep(agentRunId, "provisioning_sandbox");
    const sandbox = await provisionDockerSandbox({
      agentRunId,
      workspacePath,
      artifactsPath: sharedArtifactsRoot,
    });

    // 6. Run Goose Agent
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
      projectId: resolvedProjectId,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
    });

    const succeeded = runResult.exitCode === 0;

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
        projectId: resolvedProjectId,
        workspacePath,
        sandbox,
        artifactsMountPath: sandbox.artifactsMountPath,
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

async function resolveProjectId({
  projectId,
  prompt,
}: {
  projectId: string | null;
  prompt: string;
}) {
  if (projectId) {
    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    return existing.length ? projectId : null;
  }
  const id = randomUUID();
  const [created] = await db
    .insert(projects)
    .values({ id, name: deriveProjectName(prompt) })
    .returning();
  return created?.id ?? null;
}

function deriveProjectName(prompt: string) {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 30
    ? `${trimmed.slice(0, 27)}...`
    : trimmed || "Untitled Project";
}

async function updateRunStep(runId: string, step: string) {
  await db
    .update(agentRuns)
    .set({ currentStep: step })
    .where(eq(agentRuns.id, runId));
}
