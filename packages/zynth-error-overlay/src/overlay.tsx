import { Modal, Pressable, ScrollView, Text, View } from "@zynth/components";
import { createMemo, createSignal } from "solid-js";
import { Dimensions } from "@zynth/apis";
declare const __DEV__: boolean | undefined;

const windowHeight = Dimensions.get("window").height;

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
const IGNORE_WINDOW_MS = 8000;

let nextEntryId = 1;
let ignoredFatal: { topic: string; message: string; until: number } | null =
  null;

export function isErrorOverlayEnabled(): boolean {
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

function shouldIgnoreFatal(event: DevtoolsEvent): boolean {
  const ignored = ignoredFatal;
  if (!ignored) return false;
  if (Date.now() >= ignored.until) {
    ignoredFatal = null;
    return false;
  }
  if (event.topic !== ignored.topic) return false;
  const parts = readMessageParts(event.data);
  return parts.message === ignored.message;
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
  if (shouldIgnoreFatal(event)) return;

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
  if (!isErrorOverlayEnabled()) return;
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

function splitStack(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function deriveLocation(entry: OverlayEntry): {
  component: string;
  line: string;
} {
  const source = entry.source ?? entry.topic;
  const match = source.match(/([^/\\]+):(\d+)/);
  if (match) {
    const component = match[1] ?? source;
    const line = match[2] ?? "?";
    return { component, line };
  }
  return { component: source, line: "?" };
}

function FatalOverlay(props: {
  entry: OverlayEntry;
  onDismiss: (reason: "dismiss" | "ignore", entry: OverlayEntry) => void;
}) {
  const entry = () => props.entry;
  const header = () =>
    entry().kind === "crash" ? "Native Crash" : "Runtime Error";
  const stackLines = createMemo(() => splitStack(entry().stack));
  const location = createMemo(() => deriveLocation(entry()));
  const [copied, setCopied] = createSignal(false);

  const errorSummary = createMemo(() => {
    const lines = stackLines();
    const firstStack = lines.length > 0 ? lines[0] : "";
    const loc = location();
    const stackText =
      lines.length > 0 ? lines.join("\n") : "No stack trace available.";
    return `${entry().message}\n\nLocation: ${loc.component}:${loc.line}\n\nStack Trace:\n${stackText}\n\nTopic: ${entry().topic}`;
  });

  function handleCopy(): void {
    const text = errorSummary();
    const nav = (globalThis as any).navigator as
      | { clipboard?: { writeText?: (value: string) => Promise<void> } }
      | undefined;
    const writeText = nav?.clipboard?.writeText;
    if (typeof writeText === "function") {
      writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch((error) => {
          console.warn("[ZynthErrorOverlay] clipboard write failed", error);
        });
      return;
    }
    console.warn("[ZynthErrorOverlay] clipboard API not available");
  }

  return (
    <View
      style={{
        height: windowHeight,
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: "rgba(24,24,27,0.95)",
        zIndex: 9999,
      }}
    >
      <View
        style={{
          flex: 1,
          paddingTop: 64,
          paddingHorizontal: 20,
          paddingBottom: 140,
        }}
      >
        <View style={{ gap: 6, paddingBottom: 18 }}>
          <View
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: "rgba(239,68,68,0.12)",
              // borderWidth: 1,
              // borderColor: "rgba(239,68,68,0.28)",
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: "#ef4444",
              }}
            />
            <Text
              style={{
                color: "#ef4444",
                fontSize: 10,
                fontWeight: "800",
                textTransform: "uppercase",
                letterSpacing: 0.6,
              }}
            >
              {header()}
            </Text>
          </View>

          <Text
            style={{
              color: "#fafafa",
              fontSize: 22,
              fontWeight: "700",
              lineHeight: 28,
            }}
          >
            Something went wrong in the app
          </Text>
          <Text
            style={{
              color: "#a1a1aa",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            A JavaScript exception was detected that prevents the app from
            continuing normally.
          </Text>
        </View>

        <View style={{ flex: 1, gap: 16 }}>
          <View
            style={{
              padding: 16,
              borderRadius: 24,
              backgroundColor: "#0f0f12",
              borderWidth: 1,
              borderColor: "#27272a",
              gap: 12,
            }}
          >
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(239,68,68,0.18)",
                }}
              >
                <Text
                  style={{
                    color: "#f87171",
                    fontSize: 16,
                    fontWeight: "800",
                  }}
                >
                  {"</>"}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{
                    color: "#71717a",
                    fontSize: 11,
                    fontWeight: "700",
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  Message
                </Text>
                <Text
                  style={{
                    color: "#f87171",
                    fontSize: 13,
                    fontFamily: "Menlo",
                  }}
                >
                  {entry().message}
                </Text>
              </View>
            </View>

            <View
              style={{
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: "#27272a",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <View>
                <Text
                  style={{
                    color: "#71717a",
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  Location
                </Text>
                <Text
                  style={{
                    marginTop: 2,
                    color: "#e4e4e7",
                    fontSize: 11,
                    fontFamily: "Menlo",
                  }}
                >
                  {location().component}:{location().line}
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  borderRadius: 10,
                  backgroundColor: "rgba(245,158,11,0.12)",
                  borderWidth: 1,
                  borderColor: "rgba(245,158,11,0.32)",
                }}
              >
                <Text
                  style={{
                    color: "#f59e0b",
                    fontSize: 10,
                    fontWeight: "800",
                  }}
                >
                  Warning: Unstable State
                </Text>
              </View>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <Text
                style={{ color: "#71717a", fontSize: 12, fontWeight: "900" }}
              >
                {">"}
              </Text>
              <Text
                style={{
                  color: "#71717a",
                  fontSize: 11,
                  fontWeight: "900",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                Stack Trace
              </Text>
            </View>
            <View
              style={{
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "#27272a",
                backgroundColor: "rgba(24,24,27,0.7)",
                overflow: "hidden",
                maxHeight: 220,
              }}
            >
              <ScrollView
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  minHeight: 220,
                }}
                contentContainerStyle={{
                  paddingBottom: 12,
                  gap: 6,
                  minHeight: 150,
                }}
              >
                {stackLines().length > 0 ? (
                  stackLines().map((line, index) => (
                    <View
                      key={`${index}-${line}`}
                      style={{ flexDirection: "row" }}
                    >
                      <Text
                        style={{
                          width: 22,
                          color: "rgba(161,161,170,0.45)",
                          fontSize: 11,
                          fontFamily: "Menlo",
                        }}
                      >
                        {index + 1}
                      </Text>
                      <Text
                        style={{
                          flex: 1,
                          color: index === 0 ? "#e4e4e7" : "#a1a1aa",
                          fontSize: 11,
                          fontFamily: "Menlo",
                        }}
                      >
                        {line}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text
                    style={{
                      color: "#a1a1aa",
                      fontSize: 11,
                      fontFamily: "Menlo",
                    }}
                  >
                    No stack trace available.
                  </Text>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8, flex: 1 }}>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 20,
            paddingBottom: 24,
            paddingTop: 28,
            gap: 10,
            zIndex: 999,
            backgroundColor: "rgba(24,24,27,0.98)",
            borderTopWidth: 1,
            borderTopColor: "#27272a",
          }}
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={handleCopy}
              style={{
                flex: 1,
                paddingVertical: 13,
                borderRadius: 16,
                backgroundColor: "#27272a",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ color: "#e4e4e7", fontSize: 13, fontWeight: "700" }}
              >
                {copied() ? "Copied" : "Copy"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                console.log("Press ignore on entry:", entry());
                props.onDismiss("ignore", entry());
              }}
              style={{
                flex: 1,
                paddingVertical: 13,
                borderRadius: 16,
                backgroundColor: "#27272a",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{ color: "#e4e4e7", fontSize: 13, fontWeight: "700" }}
              >
                Ignore
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => {
              props.onDismiss("dismiss", entry());
              reloadApp();
            }}
            style={{
              width: "100%",
              paddingVertical: 15,
              borderRadius: 18,
              backgroundColor: "#dc2626",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "900" }}>
              Reload Application
            </Text>
          </Pressable>

          <View
            style={{
              alignSelf: "center",
              marginTop: 6,
              width: 120,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#3f3f46",
              opacity: 0.45,
            }}
          />
        </View>
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
          onDismiss={(reason, entry) => {
            if (reason === "ignore") {
              ignoredFatal = {
                topic: entry.topic,
                message: entry.message,
                until: Date.now() + IGNORE_WINDOW_MS,
              };
            }
            state.setFatal(null);
          }}
        />
      ) : null}
    </>
  );
}

export function wrapWithErrorOverlay(App: () => any): () => any {
  if (!isErrorOverlayEnabled()) return App;

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

export { ErrorOverlayLayer };
