import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Network } from "./Network";
import type {
  CreateNetworkDiscoveryOptions,
  DiscoveryEvent,
  NetworkAdvertiseOptions,
  NetworkService,
  NetworkState,
  NetworkSubscription,
  NetworkSubscriptionSnapshot,
} from "./types";

const DEFAULT_MAX_EVENTS = 100;

export type NetworkDiscoveryController = {
  state: () => NetworkState;
  services: () => NetworkService[];
  events: () => DiscoveryEvent[];
  discoveryRunning: () => boolean;
  loading: () => boolean;
  error: () => Error | null;
  lastSnapshotAt: () => number | null;
  peerCount: () => number;
  startDiscovery: () => Promise<void>;
  stopDiscovery: () => Promise<void>;
  startService: (options: NetworkAdvertiseOptions) => Promise<void>;
  stopService: () => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
};

export function createNetworkDiscovery(
  options?: CreateNetworkDiscoveryOptions
): NetworkDiscoveryController {
  const [state, setState] = createSignal<NetworkState>({
    type: "unknown",
    isConnected: false,
    isInternetReachable: false,
  });
  const [services, setServices] = createSignal<NetworkService[]>([]);
  const [events, setEvents] = createSignal<DiscoveryEvent[]>([]);
  const [discoveryRunning, setDiscoveryRunning] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = createSignal<number | null>(null);

  const peerCount = createMemo(() => services().length);

  const applySnapshot = (snapshot: NetworkSubscriptionSnapshot): void => {
    setState(snapshot.state);
    setDiscoveryRunning(snapshot.discoveryRunning);
    setServices(snapshot.services);

    if (snapshot.events.length > 0) {
      setEvents((current) => [...snapshot.events, ...current].slice(0, 200));
    }

    setLastSnapshotAt(snapshot.timestamp);
    setError(null);
  };

  const startDiscovery = async (): Promise<void> => {
    setLoading(true);
    try {
      await Network.startDiscoveryAsync(options);
      setDiscoveryRunning(true);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      setLoading(false);
    }
  };

  const stopDiscovery = async (): Promise<void> => {
    setLoading(true);
    try {
      await Network.stopDiscoveryAsync();
      setDiscoveryRunning(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      setLoading(false);
    }
  };

  const startService = async (serviceOptions: NetworkAdvertiseOptions): Promise<void> => {
    setLoading(true);
    try {
      await Network.startServiceAsync(serviceOptions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      setLoading(false);
    }
  };

  const stopService = async (): Promise<void> => {
    setLoading(true);
    try {
      await Network.stopServiceAsync();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      setLoading(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextState, nextServices, nextEvents, running] = await Promise.all([
        Network.getNetworkStateAsync(),
        Network.getDiscoveredServicesAsync({ includeSelf: options?.includeSelf }),
        Network.drainDiscoveryEventsAsync(
          options?.maxEvents ?? DEFAULT_MAX_EVENTS,
          { includeSelf: options?.includeSelf }
        ),
        Network.isDiscoveryRunningAsync(),
      ]);

      setState(nextState);
      setServices(nextServices);
      setDiscoveryRunning(running);
      if (nextEvents.length > 0) {
        setEvents((current) => [...nextEvents, ...current].slice(0, 200));
      }
      setLastSnapshotAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      setLoading(false);
    }
  };

  const clear = async (): Promise<void> => {
    await Network.clearDiscoveredServicesAsync();
    setServices([]);
    setEvents([]);
    setLastSnapshotAt(Date.now());
  };

  createEffect(() => {
    let subscription: NetworkSubscription | null = null;

    subscription = Network.subscribe(applySnapshot, {
      ...options,
      includeSelf: options?.includeSelf,
      maxEvents: options?.maxEvents,
      pollIntervalMs: options?.pollIntervalMs,
      emitImmediately: options?.emitImmediately,
    });

    if (options?.autoStart) {
      void startDiscovery();
    }

    onCleanup(() => {
      subscription?.remove();
      if (options?.autoStart) {
        void Network.stopDiscoveryAsync();
      }
    });
  });

  return {
    state,
    services,
    events,
    discoveryRunning,
    loading,
    error,
    lastSnapshotAt,
    peerCount,
    startDiscovery,
    stopDiscovery,
    startService,
    stopService,
    refresh,
    clear,
  };
}
