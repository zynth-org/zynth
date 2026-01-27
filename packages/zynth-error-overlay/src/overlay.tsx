import { Pressable, ScrollView, Text, View } from "@zynth/components";
import { createMemo, createSignal } from "solid-js";

declare const __DEV__: boolean | undefined;

export type DevtoolsEvent = {
  topic: string;
  ts?: number;
  level?: string;
  tag?: string;
  data?: unknown;
  runtime?: Record<string, unknown>;
};

export type DevtoolsListener = (event: DevtoolsEvent) => void;
export type DevtoolsListenerAdd = (listener: DevtoolsListener) => () => void;

type OverlayKind = "error" | "crash" | "warning";

type OverlayEntry = {
  id: number;
  kind: OverlayKind;
  topic: string;
  level?: string;
  tag?: string;
  ts: number;
  message: string;
  stack?: string;
  source?: string;
};

type OverlayState = {
  fatal: () => OverlayEntry | null;
  setFatal: (entry: OverlayEntry | null) => void;
  warnings: () => OverlayEntry[];
  setWarnings: (updater: (prev: OverlayEntry[]) => OverlayEntry[]) => void;
  ensureInstalled: (addListener: DevtoolsListenerAdd) => void;
};

const OVERLAY_STATE_KEY = "__ZYNTH_ERROR_OVERLAY_STATE__";
const MAX_WARNINGS = 50;

let nextEntryId = 1;

function shouldEnableOverlay(): boolean {
  if (typeof __DEV__ !== "undefined") {
    return Boolean(__DEV__);
  }
  const g = globalThis as any;
  const env = g?.process?.env?.NODE_ENV;
  if (typeof env === "string") {
    return env !== "production";
  }
  return true;
}

function readMessageParts(data: unknown): {
  message: string;
  stack?: string;
  source?: string;
} {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.length === 0) {
      return { message: "Unknown error" };
    }
    const lines = trimmed.split("\n");
    const message = lines[0] ?? trimmed;
    const stack = lines.length > 1 ? lines.slice(1).join("\n") : undefined;
    return { message, stack };
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const messageCandidate = record.message ?? record.reason ?? record.error;
    const stackCandidate = record.stack ?? record.stacktrace;
    const sourceCandidate = record.source ?? record.context ?? record.runtime;
    const message =
      typeof messageCandidate === "string" && messageCandidate.trim().length > 0
        ? messageCandidate.trim()
        : "Unknown error";
    const stack =
      typeof stackCandidate === "string" && stackCandidate.trim().length > 0
        ? stackCandidate
        : undefined;
    const source =
      typeof sourceCandidate === "string" && sourceCandidate.trim().length > 0
        ? sourceCandidate
        : undefined;
    return { message, stack, source };
  }

  if (data == null) {
    return { message: "Unknown error" };
  }

  try {
    return { message: String(data) };
  } catch {
    return { message: "Unknown error" };
  }
}

function eventToEntry(event: DevtoolsEvent, kind: OverlayKind): OverlayEntry {
  const parts = readMessageParts(event.data);
  return {
    id: nextEntryId++,
    kind,
    topic: event.topic,
    level: event.level,
    tag: event.tag,
    ts: typeof event.ts === "number" ? event.ts : Date.now(),
    message: parts.message,
    stack: parts.stack,
    source: parts.source,
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function handleDevtoolsEvent(state: OverlayState, event: DevtoolsEvent): void {
  if (!event || typeof event.topic !== "string") return;

  const isWarning = event.topic === "log/console" && event.level === "warn";
  if (isWarning) {
    const warningEntry = eventToEntry(event, "warning");
    state.setWarnings((prev) => {
      const next = [...prev, warningEntry];
      if (next.length > MAX_WARNINGS) {
        return next.slice(next.length - MAX_WARNINGS);
      }
      return next;
    });
    return;
  }

  const isErrorTopic =
    event.topic.startsWith("error/") || event.topic.startsWith("crash/");
  if (!isErrorTopic) return;

  const kind: OverlayKind = event.topic.startsWith("crash/")
    ? "crash"
    : "error";
  state.setFatal(eventToEntry(event, kind));
}

function getOverlayState(): OverlayState {
  const g = globalThis as any;
  const existing = g[OVERLAY_STATE_KEY] as OverlayState | undefined;
  if (existing) return existing;

  const [fatal, setFatal] = createSignal<OverlayEntry | null>(null);
  const [warnings, setWarningsSignal] = createSignal<OverlayEntry[]>([]);

  let unsubscribe: (() => void) | null = null;
  let lastAddListener: DevtoolsListenerAdd | null = null;

  const state: OverlayState = {
    fatal,
    setFatal,
    warnings,
    setWarnings(updater) {
      const prev = warnings();
      const next = updater(prev);
      setWarningsSignal(next);
    },
    ensureInstalled(addListener) {
      if (unsubscribe && lastAddListener === addListener) return;
      if (unsubscribe && lastAddListener !== addListener) {
        try {
          unsubscribe();
        } catch {
          // Ignore listener cleanup failures.
        }
        unsubscribe = null;
      }
      lastAddListener = addListener;
      unsubscribe = addListener((event) => {
        try {
          handleDevtoolsEvent(state, event);
        } catch {
          // Never allow diagnostics handling to crash the app.
        }
      });
    },
  };

  g[OVERLAY_STATE_KEY] = state;
  return state;
}

export function installErrorOverlayDiagnostics(
  addListener: DevtoolsListenerAdd,
): void {
  if (!shouldEnableOverlay()) return;
  const state = getOverlayState();
  state.ensureInstalled(addListener);
}

function reloadApp(): void {
  const g = globalThis as any;
  if (typeof g.__zynth_rerenderApp === "function") {
    try {
      g.__zynth_rerenderApp();
      return;
    } catch {
      // Ignore reload failures; the overlay will still be visible.
    }
  }
  console.warn("[ZynthErrorOverlay] __zynth_rerenderApp not available");
}

function FatalOverlay(props: { entry: OverlayEntry; onDismiss: () => void }) {
  const entry = () => props.entry;
  const header = () =>
    entry().kind === "crash" ? "Native Crash" : "Runtime Error";
  const stackText = () => entry().stack ?? "";
  const sourceText = () => entry().source ?? entry().topic;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 9999,
        backgroundColor: "#f8879c",
        paddingTop: 56,
        paddingBottom: 28,
        paddingHorizontal: 16,
        gap: 12,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>
        {header()}
      </Text>
      <Text style={{ color: "#ffe4e6", fontSize: 12 }}>{sourceText()}</Text>

      <View
        style={{
          backgroundColor: "#7f1d1d",
          borderRadius: 12,
          padding: 12,
          gap: 6,
        }}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
          {entry().message}
        </Text>
      </View>

      <ScrollView
        style={{
          flex: 1,
          backgroundColor: "#450a0a",
          borderRadius: 12,
          padding: 12,
        }}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <Text style={{ color: "#fecaca", fontSize: 12 }}>
          {stackText().length > 0 ? stackText() : "No stack trace available."}
        </Text>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => {
            props.onDismiss();
          }}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: "#111827",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Dismiss</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            props.onDismiss();
            reloadApp();
          }}
          style={{
            flex: 1,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: "#0ea5e9",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#06283a", fontWeight: "700" }}>Reload</Text>
        </Pressable>
      </View>
    </View>
  );
}

function WarningBanner(props: {
  count: number;
  lastMessage: string;
  onClear: () => void;
}) {
  const countText = () =>
    props.count === 1 ? "1 warning" : `${props.count} warnings`;
  const subtitle = () => truncate(props.lastMessage, 140);

  return (
    <Pressable
      onPress={() => props.onClear()}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 9998,
        backgroundColor: "#f59e0b",
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 2,
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 8,
      }}
    >
      <Text style={{ color: "#1f2937", fontWeight: "800" }}>{countText()}</Text>
      <Text style={{ color: "#4b5563", fontSize: 12 }}>{subtitle()}</Text>
      <Text style={{ color: "#374151", fontSize: 11 }}>Tap to clear</Text>
    </Pressable>
  );
}

function ErrorOverlayLayer() {
  const state = getOverlayState();
  const fatalEntry = state.fatal;
  const warnings = state.warnings;

  const warningCount = () => warnings().length;
  const lastWarning = createMemo(() => {
    const list = warnings();
    if (list.length === 0) return null;
    return list[list.length - 1] ?? null;
  });

  const showWarnings = () => fatalEntry() == null && warningCount() > 0;

  return (
    <>
      {showWarnings() && lastWarning() ? (
        <WarningBanner
          count={warningCount()}
          lastMessage={lastWarning()!.message}
          onClear={() => state.setWarnings(() => [])}
        />
      ) : null}

      {fatalEntry() ? (
        <FatalOverlay
          entry={fatalEntry()!}
          onDismiss={() => state.setFatal(null)}
        />
      ) : null}
    </>
  );
}

export function wrapWithErrorOverlay(App: () => any): () => any {
  if (!shouldEnableOverlay()) return App;

  const WrappedApp = () => {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>{App()}</View>
        <ErrorOverlayLayer />
      </View>
    );
  };

  return WrappedApp;
}
