# Skyhook Refactor: OpenCode Pipeline

## Objective
Refactor the `/api/generate` endpoint to support a robust, atomic pipeline for provisioning AI agent environments (OpenCode) using Docker. This includes workspace generation, artifact provisioning, and database tracking.

## 1. Database & Schema
- [x] **Review Schema:** Check `packages/zynth-skyhook/src/db/schema` to ensure we can store all necessary metadata.
    - `projects`: Added `settings`.
    - `generation_requests`: Verified.
    - `agent_runs`: Added `artifactsPath`, `currentStep`, `runnerConfig`.

## 2. Refactor Endpoint (`post-generate-request.ts`)
- [x] **Pipeline Structure:** Rewrite the handler to execute steps sequentially/atomically.
    - [x] Implemented in `src/controllers/generate.ts`.
    - [x] Deleted old `src/routes`.

## 3. Workspace Generation (Boilerplate)
- [x] **Port CLI Logic:** Adapted in `src/services/provisioning.ts`.
- [x] **Template Source:** Uses `packages/zynth-cli/src/templates/app`.
- [x] **File Generation:** Implemented.

## 4. Artifacts Management
- [x] **Identify Packages:** Defined in `src/services/provisioning.ts`.
- [x] **Collection Logic:** Implemented `stageInternalArtifacts`.
- [x] **Staging:** Artifacts are copied to `<runDir>/artifacts`.
- [x] **Integration Strategy:** Artifacts mounted to `/opt/zynth-artifacts` (read-only) and `package.json` updated to use `file:` protocol.

## 5. Docker Provisioning
- [x] **Update `provisionDockerSandbox`:**
    - [x] Accepts `artifactsPath`.
    - [x] Mounts `artifactsPath` to `/opt/zynth-artifacts`.

## 6. Execution & Verification
- [ ] **Verify Files:** Ensure boilerplate files are correctly created on the host.
- [ ] **Verify Docker:** Ensure the container starts, mounts are accessible, and `node_modules` resolves internal packages correctly.
