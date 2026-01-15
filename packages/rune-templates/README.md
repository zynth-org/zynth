# @rune/templates

Standard project templates for the Rune CLI.

This package contains the blueprints used by `rune create` and `rune prebuild` to scaffold new applications and generate native code.

## Templates

*   **`app`**: The default starter template for new Rune applications. Includes a basic directory structure, TypeScript config, and example components.
*   **`app-module`**: Template for creating a reusable Rune UI library.
*   **`native-module`**: Template for creating a package with native (Swift/Kotlin) code.
*   **`ios` / `android`**: The native project shells (Xcode workspace / Android Gradle project) generated during the prebuild process.

## Usage

These templates are consumed automatically by the CLI. You typically do not need to use this package directly.

```bash
# Uses the 'app' template
rune create my-app
```
