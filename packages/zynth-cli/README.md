# zynth

The command-line interface for the Zynth framework.

This tool orchestrates the development, build, and bundling process for Zynth applications. It handles the generation of native project files (bootstrap), managing the dev server, and bundling JavaScript code for production.

## Commands

- `zynth dev <platform>`: Runs iOS/Android native flows or web (`zynth dev web`) with automatic web scaffold setup.
- `zynth start`: Starts the JavaScript dev server (`rsbuild dev`) and Zynth devtools hub without `concurrently`.
- `zynth bootstrap`: Generates/Updates the native `android` and `ios` project directories based on the project configuration and installed modules.
- `zynth build <platform>`: Builds iOS/Android native artifacts or web (`zynth build web`) with automatic web scaffold setup.
- `zynth bundle`: Bundles the JavaScript application into a single file for production.
- `zynth reset`: Cleans and regenerates the native directories from scratch.
- `zynth create`: Scaffolds a new Zynth application.
- `zynth automation`: Reads native screen snapshots and runs snapshot diffs via the devtools hub.
- `zynth permissions`: Applies predefined app.json permission presets (for example `media-library`, `file-intents`).

### Permissions Wizard

Use interactive onboarding:

- `zynth permissions` (defaults to `wizard`)
  - Step 1: Select presets with `SPACE`, confirm with `ENTER`.
  - Step 2: Edit default permission text values (for example iOS `infoPlist` usage strings).

Non-interactive options:

- `zynth permissions list`
- `zynth permissions add media-library`
- `zynth permissions add file-intents`

### Runtime Selection

Zynth now defaults to the core runtime in `@zynthjs/core`; the legacy runtimes are no longer used by the CLI.

### **CLI Aesthetic Design Principles**

To ensure a cohesive, reliable, and professional user experience across all operating systems, the CLI adheres to the following design philosophy:

#### 1. Understated Technicality (No Emojis)

The CLI interface prioritizes clarity and technical precision over decorative elements. Emojis are strictly prohibited. Visual feedback is achieved exclusively through standard Unicode geometric shapes, ASCII characters, and terminal color coding.

#### 2. Terminal Aesthetic (Green Accents)

To evoke a serious, "Fallout console" technical feel, the CLI uses a specific color palette:

- **Primary Accents:** Dark Green (`#00FF00` or ANSI green) for success symbols (`✔`), primary bullets (`◆`), and progress bars.
- **Dimmed Text:** Gray for secondary information and paths.
- **High Contrast:** White for active tasks and critical summaries.

#### 3. Structural Integrity & Reliability

Output must remain stable and readable across different terminal emulators, including legacy Windows consoles.

- **Safe Unicode:** Only use widely supported characters (`◆`, `✔`, `└`, `─`).
- **No Scrolling Interference:** Active processes must not overwrite previously printed, non-relevant logs. The terminal history must remain clean.

#### 3. Compact State Representation

To reduce cognitive load during complex operations (like compilation), detailed information is encapsulated into compact, high-density views.

- **Progressive Summarization:** Instead of listing all components in a long vertical list, show an active counter (`x/y tasks completed`) and a single, prominent line for the currently processing item.
- **Transient Feedback:** Dynamic content (spinners, progress bars) should be confined to a single, rewritable line to avoid creating a massive log history.

#### 4. Persistent Functional Shimmers

Processes that require long-running calculations, such as native artifact generation, must utilize a non-intrusive, persistent visual indicator (e.g., a subtle "shimmer" or terminal-safe animation) to communicate activity without disrupting the structural layout of the logs.

---

### Implementation Example (The "Compact Log" Inset)

Based on these principles, here is how a build command should behave:

```text
◆ Building Components (debug)...
  [▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░] 30%
  ↳ Compiling: skia
  ➔ 5/22 components built...

```

_When the build completes, the detailed line is replaced by a final summary:_

```text
◆ Building Components (debug)...
✔ Completed 22 modules in 14.2s

```
