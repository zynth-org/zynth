# @rune/cli

The command-line interface for the Rune framework.

This tool orchestrates the development, build, and bundling process for Rune applications. It handles the generation of native project files (prebuild), managing the dev server, and bundling JavaScript code for production.

## Commands

*   `rune dev`: Starts the development server with Hot Module Replacement (HMR).
*   `rune prebuild`: Generates/Updates the native `android` and `ios` project directories based on the project configuration and installed modules.
*   `rune build`: Builds the native application.
*   `rune bundle`: Bundles the JavaScript application into a single file for production.
*   `rune reset`: Cleans and regenerates the native directories from scratch.
*   `rune create`: Scaffolds a new Rune application.
