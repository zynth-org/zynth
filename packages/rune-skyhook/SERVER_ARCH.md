# Skyhook Server Architecture

Skyhook is the backend orchestration server for the Rune framework, responsible for managing the lifecycle of Rune applications. It handles operations such as creating new applications, updating existing ones, and integrating with an AI coding agent (Goose) to generate or modify application source code.

## Key Functionality

### 1. App Management Endpoints

Skyhook exposes the following primary API endpoints for managing Rune applications:

-   **`POST /app/create`**:
    *   **Purpose**: Initiates the creation of a new Rune application.
    *   **Workflow**:
        1.  Receives a `prompt` (and optionally an `appId` if re-attempting a specific ID).
        2.  Records a new `generation_request` and `agent_run` in the database.
        3.  Resolves an `appId` (either provided or a new UUID).
        4.  Provisions a temporary workspace: creates a directory, copies base app templates, and links shared Rune artifacts (`@rune/core`, etc.).
        5.  Provisions a Docker sandbox environment.
        6.  Executes the **Goose Agent** within the sandbox, providing the user prompt.
        7.  Upon successful completion of the agent run:
            *   Uploads agent logs (stdout/stderr) to MinIO/S3.
            *   **Compresses the generated workspace** into a `.zip` archive.
            *   **Uploads this archive as a snapshot to MinIO/S3** (key format: `apps/{appId}/runs/{agentRunId}/snapshot.zip`).
        8.  Updates the database with the run status and snapshot URL.
        9.  Returns details about the created app and run.

-   **`POST /app/:appId/source/update`**:
    *   **Purpose**: Updates the source code of an existing Rune application based on a new prompt.
    *   **Workflow**:
        1.  Receives an `appId` from the URL parameter and a `prompt` in the request body.
        2.  Validates the existence of the `appId` in the database.
        3.  Records a new `generation_request` and `agent_run` for the update operation.
        4.  **Loads the latest existing application snapshot from MinIO/S3.**
            *   **Note**: Currently, this loads `apps/{appId}/runs/latest/snapshot.zip`. The mechanism to reliably determine the "latest" `runId` from the database for loading (e.g., querying `agent_runs` for the last successful run) needs to be implemented.
        5.  Extracts the loaded snapshot into a temporary workspace.
        6.  Re-links shared Rune artifacts.
        7.  Provisions a Docker sandbox environment.
        8.  Executes the **Goose Agent** within the sandbox, providing the new user prompt and the existing app's context.
        9.  Upon successful completion of the agent run:
            *   Uploads agent logs to MinIO/S3.
            *   **Compresses the updated workspace** into a `.zip` archive.
            *   **Uploads this new archive as a snapshot to MinIO/S3** (key format: `apps/{appId}/runs/{newAgentRunId}/snapshot.zip`).
        10. Updates the database with the run status and new snapshot URL.
        11. Returns details about the update run.

### 2. Core Concepts

-   **Apps (formerly Projects)**: Represents a Rune application. Stored in the database with metadata like name, description, and settings.
-   **Agent Runs**: Tracks each execution of the Goose AI agent, linking to a specific app and generation request. Stores execution details, status, and logs.
-   **Generation Requests**: Records each user request to generate or update an app.
-   **Workspace Provisioning**: The process of setting up isolated environments for agent execution, including copying templates and managing shared dependencies.
-   **Docker Sandboxing**: Utilizes Docker containers to provide a secure and isolated environment for the Goose Agent to operate on application code.
-   **MinIO/S3 Snapshots**: Used for persistent storage of application workspaces. After each successful agent run, the resulting workspace is zipped and saved to MinIO/S3, allowing for versioning and retrieval of application states.
-   **Prebundled Artifacts**: A pre-install step collects JS `dist/` outputs from eligible packages into `packages/rune-skyhook/vendor/prebundle`. Skyhook mounts this directory into the Docker sandbox so agent workspaces can use `file:` dependencies without accessing the monorepo.

### 4. Artifact Prebundle Workflow

Skyhook expects a prebuilt artifacts directory to exist before the server starts.

-   Run `yarn bundle` in the monorepo to generate `dist/` outputs.
-   Run `node scripts/build-skyhook-artifacts.ts` to populate `packages/rune-skyhook/vendor/prebundle`.
-   Optionally set `SKYHOOK_ARTIFACTS_DIR` to override the default path (useful for Docker images or mounted volumes).

Packages can opt out of the prebundle by adding:

```
{
  "runeSkyhook": { "artifacts": false }
}
```

### 3. Database Schema (Drizzle ORM)

The database schema, managed with Drizzle ORM, includes the following key tables:

-   **`apps`**: Stores metadata for each Rune application.
    -   `id` (UUID, PK)
    -   `userId` (text)
    -   `name` (text)
    -   `description` (text)
    -   `iconUrl`, `splashUrl` (text)
    -   `settings` (JSONB)
    -   `createdAt`, `updatedAt` (timestamp)

-   **`generation_requests`**: Records each prompt-driven request for app generation or update.
    -   `id` (UUID, PK)
    -   `prompt` (text)
    -   `appId` (UUID, FK to `apps.id`)
    -   `status` (enum: 'pending', 'running', 'succeeded', 'failed')
    -   `errorMessage` (text)
    -   `createdAt`, `updatedAt` (timestamp)

-   **`agent_runs`**: Detailed logs and status for each execution of the Goose agent.
    -   `id` (UUID, PK)
    -   `appId` (UUID, FK to `apps.id`)
    -   `requestId` (UUID, FK to `generation_requests.id`)
    -   `sandboxId` (text)
    -   `runner`, `workspacePath`, `artifactsPath` (text)
    -   `currentStep` (text)
    -   `runnerConfig`, `runnerEvents` (JSONB)
    -   `runnerCommand`, `runnerExitCode`, `runnerStdout`, `runnerStderr`, `runnerLogsUrl` (text/integer)
    -   `status` (enum: 'queued', 'running', 'succeeded', 'failed', 'cancelled')
    -   `llmModel`, `promptTokens`, `completionTokens` (text/integer)
    -   `errorMessage` (text)
    -   `createdAt`, `updatedAt`, `startedAt`, `completedAt` (timestamp)
