type ReadResult = { value?: any; done: boolean };

declare const global: any;

function debugLog(..._args: any[]): void {}

type UnderlyingSource = {
  start?: (controller: ReadableStreamDefaultController) => void;
  pull?: (controller: ReadableStreamDefaultController) => void;
  cancel?: (reason?: any) => void;
};

class ReadableStreamDefaultController {
  private readonly stream: ReadableStreamPolyfill;

  constructor(stream: ReadableStreamPolyfill) {
    this.stream = stream;
  }

  enqueue(chunk: any): void {
    this.stream.enqueue(chunk);
  }

  close(): void {
    this.stream.close();
  }

  error(reason?: any): void {
    this.stream.error(reason);
  }
}

class ReadableStreamDefaultReader {
  private readonly stream: ReadableStreamPolyfill;

  constructor(stream: ReadableStreamPolyfill) {
    this.stream = stream;
  }

  read(): Promise<ReadResult> {
    return this.stream.read();
  }

  cancel(reason?: any): Promise<void> {
    return this.stream.cancel(reason);
  }
}

class ReadableStreamPolyfill {
  private readonly source?: UnderlyingSource;
  private readonly controller: ReadableStreamDefaultController;
  private readonly queue: any[] = [];
  private readonly pending: Array<{
    resolve: (value: ReadResult) => void;
    reject: (reason?: any) => void;
  }> = [];
  private closed = false;
  private errored: any = null;
  locked = false;

  constructor(source: UnderlyingSource = {}) {
    this.source = source;
    this.controller = new ReadableStreamDefaultController(this);
    if (this.source.start) {
      this.source.start(this.controller);
    }
  }

  getReader(): ReadableStreamDefaultReader {
    if (this.locked) {
      throw new TypeError("ReadableStream is locked");
    }
    this.locked = true;
    return new ReadableStreamDefaultReader(this);
  }

  enqueue(chunk: any): void {
    if (this.closed || this.errored) return;
    const pending = this.pending.shift();
    if (pending) {
      debugLog("enqueue -> resolve pending");
      pending.resolve({ value: chunk, done: false });
      return;
    }
    debugLog("enqueue -> queue");
    this.queue.push(chunk);
  }

  close(): void {
    if (this.closed || this.errored) return;
    this.closed = true;
    debugLog("close");
    while (this.pending.length) {
      this.pending.shift()?.resolve({ done: true });
    }
  }

  error(reason?: any): void {
    if (this.errored) return;
    this.errored = reason ?? new Error("ReadableStream error");
    while (this.pending.length) {
      this.pending.shift()?.reject(this.errored);
    }
  }

  read(): Promise<ReadResult> {
    if (this.errored) {
      return Promise.reject(this.errored);
    }
    if (this.queue.length) {
      const value = this.queue.shift();
      debugLog("read -> from queue");
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) {
      debugLog("read -> closed");
      return Promise.resolve({ done: true });
    }
    debugLog("read -> pending");
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      if (this.source?.pull) {
        this.source.pull(this.controller);
      }
    });
  }

  cancel(reason?: any): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.queue.length = 0;
    if (this.source?.cancel) {
      try {
        this.source.cancel(reason);
      } catch (_) {}
    }
    while (this.pending.length) {
      this.pending.shift()?.resolve({ done: true });
    }
    return Promise.resolve();
  }

  tee(): [ReadableStreamPolyfill, ReadableStreamPolyfill] {
    debugLog("tee");
    const reader = this.getReader();
    const queueA: any[] = [];
    const queueB: any[] = [];
    let controllerA: ReadableStreamDefaultController | null = null;
    let controllerB: ReadableStreamDefaultController | null = null;
    let closed = false;
    let reading = false;

    const pump = () => {
      if (reading || closed) return;
      reading = true;
      debugLog("tee pump -> read");
      reader
        .read()
        .then(({ value, done }) => {
          reading = false;
          if (done) {
            closed = true;
            debugLog("tee pump -> done");
            controllerA?.close();
            controllerB?.close();
            return;
          }
          debugLog("tee pump -> chunk");
          if (controllerA) {
            controllerA.enqueue(value);
          } else {
            queueA.push(value);
          }
          if (controllerB) {
            controllerB.enqueue(value);
          } else {
            queueB.push(value);
          }
        })
        .catch(() => {
          reading = false;
          closed = true;
          debugLog("tee pump -> error");
          controllerA?.error(new Error("ReadableStream tee error"));
          controllerB?.error(new Error("ReadableStream tee error"));
        });
    };

    const makeStream = (queue: any[], setController: (c: ReadableStreamDefaultController) => void) =>
      new ReadableStreamPolyfill({
        start(controller) {
          setController(controller);
          while (queue.length) {
            controller.enqueue(queue.shift());
          }
        },
        pull(controller) {
          if (queue.length) {
            controller.enqueue(queue.shift());
            return;
          }
          if (closed) {
            controller.close();
            return;
          }
          pump();
        },
        cancel(reason) {
          reader.cancel(reason);
        },
      });

    return [
      makeStream(queueA, controller => {
        controllerA = controller;
      }),
      makeStream(queueB, controller => {
        controllerB = controller;
      }),
    ];
  }
}

const globalObject =
  typeof globalThis !== "undefined"
    ? (globalThis as any)
    : typeof window !== "undefined"
    ? (window as any)
    : typeof global !== "undefined"
    ? (global as any)
    : ({} as any);

if (globalObject && typeof globalObject.ReadableStream !== "function") {
  console.log("[RuneCore] Polyfilling ReadableStream");
  globalObject.ReadableStream = ReadableStreamPolyfill;
}

export {
  ReadableStreamPolyfill as ReadableStream,
  ReadableStreamDefaultReader,
  ReadableStreamDefaultController,
};
