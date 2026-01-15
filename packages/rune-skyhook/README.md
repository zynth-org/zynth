# @rune/skyhook

The AI-powered backend for generating and deploying Rune applications.

Skyhook is a specialized server that orchestrates **LLM-based code generation** to build Rune apps from natural language prompts. It manages the entire lifecycle of an AI generation run, from provisioning sandboxed environments to building the final bundle.

## Features

*   **Prompt-to-App**: Accepts text descriptions (e.g., "Create a to-do list app") and uses an LLM (via OpenRouter) to generate the full source code.
*   **Sandboxed Execution**: Runs the generation agent inside isolated Docker containers for security and consistency.
*   **Iterative Updates**: Can modify existing applications by loading their snapshot and applying new prompts.
*   **Build Pipeline**: Automatically builds the generated project into a deployable bundle.
*   **Artifact Linking**: Injects the local `@rune/*` packages into the generation environment, ensuring the AI uses the latest framework version.

## Architecture

1.  **Orchestrator**: Receives requests and manages the state in a database (via Drizzle ORM).
2.  **Provisioner**: Creates a temporary workspace and sets up a Docker sandbox.
3.  **Agent (Goose)**: An AI agent runs inside the container, writing code to satisfy the user's prompt.
4.  **Builder**: Compiles the generated code.
5.  **Storage**: Saves snapshots and bundles for deployment.

## API Endpoints

### `POST /app/create`
Generate a new application from scratch.
*   **Body**: `{ "prompt": "Describe your app here..." }`
*   **Returns**: `agentRunId`, `appId`, streams logs/status.

### `POST /app/:appId/source/update`
Update an existing application.
*   **Body**: `{ "prompt": "Add a dark mode toggle" }`
*   **Returns**: Updated snapshot and build status.

## Environment Variables

*   `OPENROUTER_API_KEY`: API key for the LLM provider.
*   `SKYHOOK_PORT`: Port to run the server on (default: 9964).
*   `SKYHOOK_WORKSPACES_DIR`: Directory for temporary code generation.
