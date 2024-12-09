import pc from "picocolors";

export class Logger {
  // private startTime = Date.now();

  // /**
  //  * Get elapsed time since logger creation
  //  */
  // private getElapsedTime(): string {
  //   const elapsed = Date.now() - this.startTime;
  //   const seconds = Math.floor(elapsed / 1000);
  //   const ms = elapsed % 1000;
  //   return `${seconds}s ${ms}ms`;
  // }

  // /**
  //  * Format timestamp
  //  */
  // private timestamp(): string {
  //   return pc.gray(`[${new Date().toLocaleTimeString()}]`);
  // }

  serverStarted(port: number, host: string = "localhost"): void {
    console.log("");
    console.log(pc.green("✓ Rune HMR server started"));
    console.log(pc.cyan(`  ➜ Local:   http://${host}:${port}`));
    console.log(pc.gray(`  ➜ Bundle:  http://${host}:${port}/bundle/main.js`));
    console.log(pc.gray(`  ➜ Assets:  http://${host}:${port}/assets/`));
    console.log("");
  }

  serverStopped(): void {
    console.log(pc.yellow("\n⚠ Rune HMR server stopped\n"));
  }

  bundleBuilding(): void {
    console.log(pc.cyan("📦 Building bundle..."));
  }

  bundleReady(bundlePath: string, size?: number): void {
    const sizeStr = size ? pc.gray(` (${this.formatSize(size)})`) : "";
    console.log(pc.green(`✓ Bundle ready${sizeStr}`));
    console.log(pc.gray(`  ${bundlePath}`));
  }

  bundleError(error: Error): void {
    console.log(pc.red("✗ Bundle build failed"));
    console.log(pc.red(`  ${error.message}`));
  }

  clientConnected(platform: string, info?: string): void {
    const details = info ? pc.gray(` (${info})`) : "";
    console.log(pc.blue(`📱 ${platform} device connected${details}`));
  }

  clientDisconnected(platform: string): void {
    console.log(pc.gray(`📱 ${platform} device disconnected`));
  }

  clientHandshake(data: any): void {
    const platform = data.platform || "unknown";
    const version = data.version ? pc.gray(` v${data.version}`) : "";
    console.log(pc.blue(`🤝 Handshake from ${platform}${version}`));
  }

  bundleRequested(platform: string): void {
    console.log(pc.yellow(`⬇️  ${platform} requested bundle`));
  }

  updateSent(clientCount: number): void {
    const plural = clientCount === 1 ? "client" : "clients";
    console.log(pc.magenta(`📤 Update sent to ${clientCount} ${plural}`));
  }

  fileChanged(filePath: string): void {
    console.log(pc.cyan(`📝 File changed: ${filePath}`));
  }

  assetScanned(count: number): void {
    console.log(pc.gray(`  Scanned ${count} assets`));
  }

  error(message: string, error?: Error): void {
    console.log(pc.red(`✗ ${message}`));
    if (error) {
      console.log(pc.red(`  ${error.message}`));
      if (error.stack) {
        console.log(pc.gray(error.stack));
      }
    }
  }

  info(message: string): void {
    console.log(pc.cyan(`ℹ ${message}`));
  }

  warn(message: string): void {
    console.log(pc.yellow(`⚠ ${message}`));
  }

  debug(message: string): void {
    console.log(pc.gray(`  ${message}`));
  }

  /**
   * Format byte size to human-readable string
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}
