import { createSignal, type Accessor } from "solid-js";
import { WebServer } from "./WebServer";
import type {
  WebServerEvent,
  WebServerInfo,
  WebServerStartOptions,
  WebServerStatus,
  WebServerSubscribeOptions,
  WebServerSubscription,
  WebServerSubscriptionSnapshot,
  WebServerUploadState,
} from "./types";

export type WebServerSignal = {
  status: Accessor<WebServerStatus>;
  info: Accessor<WebServerInfo | null>;
  error: Accessor<Error | null>;
  start(options?: WebServerStartOptions): Promise<WebServerInfo>;
  stop(): Promise<void>;
  pollEvents(maxEvents?: number): Promise<WebServerEvent[]>;
  getUploadState(): Promise<WebServerUploadState>;
  setSignal(key: string, payload: unknown): Promise<void>;
  getSignal<T = unknown>(key: string, consume?: boolean): Promise<T | null>;
  setReply(key: string, payload: unknown): Promise<void>;
  getReply<T = unknown>(key: string, consume?: boolean): Promise<T | null>;
  subscribe(
    listener: (snapshot: WebServerSubscriptionSnapshot) => void,
    options?: WebServerSubscribeOptions
  ): WebServerSubscription;
};

export function createWebServerSignal(): WebServerSignal {
  const [status, setStatus] = createSignal<WebServerStatus>("idle");
  const [info, setInfo] = createSignal<WebServerInfo | null>(null);
  const [error, setError] = createSignal<Error | null>(null);

  const start = async (
    options?: WebServerStartOptions
  ): Promise<WebServerInfo> => {
    setStatus("starting");
    setError(null);
    try {
      const next = await WebServer.start(options);
      setInfo(next);
      setStatus("running");
      return next;
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err));
      setError(nextError);
      setStatus("error");
      throw nextError;
    }
  };

  const stop = async (): Promise<void> => {
    setError(null);
    try {
      await WebServer.stop();
      setStatus("stopped");
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error(String(err));
      setError(nextError);
      setStatus("error");
      throw nextError;
    }
  };

  const pollEvents = async (maxEvents?: number): Promise<WebServerEvent[]> => {
    return WebServer.drainEvents(maxEvents);
  };

  const getUploadState = async (): Promise<WebServerUploadState> => {
    return WebServer.getUploadState();
  };

  const setSignal = async (key: string, payload: unknown): Promise<void> => {
    await WebServer.setSignal(key, payload);
  };

  const getSignal = async <T = unknown>(
    key: string,
    consume?: boolean
  ): Promise<T | null> => {
    return WebServer.getSignal<T>(key, consume);
  };

  const setReply = async (key: string, payload: unknown): Promise<void> => {
    await WebServer.setReply(key, payload);
  };

  const getReply = async <T = unknown>(
    key: string,
    consume?: boolean
  ): Promise<T | null> => {
    return WebServer.getReply<T>(key, consume);
  };

  const subscribe = (
    listener: (snapshot: WebServerSubscriptionSnapshot) => void,
    options?: WebServerSubscribeOptions
  ): WebServerSubscription => {
    return WebServer.subscribe(listener, options);
  };

  return {
    status,
    info,
    error,
    start,
    stop,
    pollEvents,
    getUploadState,
    setSignal,
    getSignal,
    setReply,
    getReply,
    subscribe,
  };
}
