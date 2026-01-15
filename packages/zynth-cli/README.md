# @zynth/cli

The command-line interface for the Zynth framework.

This tool orchestrates the development, build, and bundling process for Zynth applications. It handles the generation of native project files (prebuild), managing the dev server, and bundling JavaScript code for production.

## Commands

*   `zynth dev`: Starts the development server with Hot Module Replacement (HMR).
*   `zynth prebuild`: Generates/Updates the native `android` and `ios` project directories based on the project configuration and installed modules.
*   `zynth build`: Builds the native application.
*   `zynth bundle`: Bundles the JavaScript application into a single file for production.
*   `zynth reset`: Cleans and regenerates the native directories from scratch.
*   `zynth create`: Scaffolds a new Zynth application.
