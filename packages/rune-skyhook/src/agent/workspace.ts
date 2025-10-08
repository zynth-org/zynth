import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type CreateWorkspaceInput = {
  workspacePath: string;
  prompt: string;
};

type CreateWorkspaceResult = {
  agentsMdPath: string;
};

async function createWorkspace({
  workspacePath,
  prompt,
}: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  await mkdir(workspacePath, { recursive: true });

  const agentsMdPath = join(workspacePath, "AGENTS.md");
  const bootstrap = await loadBootstrapPrompt();
  await writeFile(agentsMdPath, buildAgentsMd({ prompt, bootstrap }), "utf8");

  const readmePath = join(workspacePath, "README.md");
  await writeFile(
    readmePath,
    `# Skyhook Workspace\n\nPrompt:\n\n${prompt}\n`,
    "utf8"
  );

  return { agentsMdPath };
}

async function loadBootstrapPrompt() {
  const overridePath = process.env.SKYHOOK_AGENT_BOOTSTRAP_PATH?.trim();
  const defaultPath = fileURLToPath(
    new URL("./prompts/bootstrap.md", import.meta.url)
  );
  const path = overridePath || defaultPath;
  return readFile(path, "utf8");
}

function buildAgentsMd({
  prompt,
  bootstrap,
}: {
  prompt: string;
  bootstrap: string;
}) {
  return `# Skyhook Workspace Instructions

You are operating inside a sandboxed project workspace.

## Rules
- Only edit files inside this workspace directory.
- Prefer simple, deterministic scaffolding over inventing boilerplate.
- Keep changes minimal and focused on the user request.

## Bootstrap Prompt (Always Include)
${bootstrap.trim()}

## User Prompt
${prompt}
`;
}

export { createWorkspace };
export type { CreateWorkspaceInput, CreateWorkspaceResult };
