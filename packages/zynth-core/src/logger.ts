export class ZynthLogger {
  private static enabled = true;

  static setEnabled(flag: boolean) {
    ZynthLogger.enabled = flag;
  }

  static debug(tag: string, message?: any, ...args: any[]) {
    if (!ZynthLogger.enabled) return;
    const prefix = `[Zynth:${tag}]`;
    if (message !== undefined) {
      console.debug(prefix, message, ...args);
    } else {
      console.debug(prefix);
    }
  }

  static trace(tag: string, message?: any, ...args: any[]) {
    if (!ZynthLogger.enabled) return;
    const prefix = `[Zynth:${tag}]`;
    if (message !== undefined) {
      console.trace(prefix, message, ...args);
    } else {
      console.trace(prefix);
    }
  }

  static info(tag: string, message?: any, ...args: any[]) {
    const prefix = `[Zynth:${tag}]`;
    if (message !== undefined) {
      console.log(prefix, message, ...args);
    } else {
      console.log(prefix);
    }
  }

  static warn(tag: string, message?: any, ...args: any[]) {
    const prefix = `[Zynth:${tag}]`;
    if (message !== undefined) {
      console.warn(prefix, message, ...args);
    } else {
      console.warn(prefix);
    }
  }

  static error(tag: string, message?: any, ...args: any[]) {
    const prefix = `[Zynth:${tag}]`;
    if (message !== undefined) {
      console.error(prefix, message, ...args);
    } else {
      console.error(prefix);
    }
  }
}
