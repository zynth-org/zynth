import {
  Button,
  Pressable,
  ScrollView,
  StatusBar,
  SystemGlyph,
  Text,
  View,
} from "@zynth/components";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createRoot,
  onCleanup,
} from "solid-js";
import {
  createSafeAreaInsets,
  Dimensions,
  SafeAreaProvider,
} from "@zynth/apis";
import { symbolicateStackTrace } from "./symbolicate";
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

  const entry = eventToEntry(event, kind);
  state.setFatal(entry);

  if (entry.stack) {
    symbolicateStackTrace(entry.stack)
      .then((newStack) => {
        const current = state.fatal();
        if (current && current.id === entry.id) {
          state.setFatal({ ...current, stack: newStack });
        }
      })
      .catch(() => {
        // Ignore symbolication failures
      });
  }
}

function getOverlayState(): OverlayState {
  const g = globalThis as any;
  const existing = g[OVERLAY_STATE_KEY] as OverlayState | undefined;
  if (existing) return existing;

  return createRoot(() => {
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
  });
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

const THEME = {
  error: {
    badgeBg: "rgba(239,68,68,0.12)",
    badgeBorder: "rgba(239,68,68,0.28)",
    badgeDot: "#ef4444",
    badgeText: "#ef4444",
    iconBg: "rgba(239,68,68,0.18)",
    iconColor: "#f87171",
    messageColor: "#f87171",
  },
  warning: {
    badgeBg: "rgba(234,179,8,0.12)",
    badgeBorder: "rgba(234,179,8,0.28)",
    badgeDot: "#eab308",
    badgeText: "#eab308",
    iconBg: "rgba(234,179,8,0.18)",
    iconColor: "#facc15",
    messageColor: "#facc15",
  },
};

function DetailOverlay(props: {
  entry: OverlayEntry;
  onDismiss: (reason: "dismiss" | "ignore", entry: OverlayEntry) => void;
  onClear?: () => void;
  navigation?: {
    index: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
  };
}) {
  const entry = () => props.entry;
  const isError = () => entry().kind === "error" || entry().kind === "crash";
  const theme = () => (isError() ? THEME.error : THEME.warning);

  const header = () => {
    if (entry().kind === "crash") return "Native Crash";
    if (entry().kind === "error") return "Runtime Error";
    return "Performance Warning";
  };
  const stackLines = createMemo(() => splitStack(entry().stack));
  const location = createMemo(() => deriveLocation(entry()));
  const [copied, setCopied] = createSignal(false);
  const [windowSize, setWindowSize] = createSignal(Dimensions.get("window"));
  createEffect(() => {
    const unsubscribe = Dimensions.observe("window", (metrics) => {
      setWindowSize(metrics);
    });
    onCleanup(unsubscribe);
  });
  const insets = createSafeAreaInsets();
  const windowHeight = () => windowSize().height;
  const windowWidth = () => windowSize().width;

  const errorSummary = createMemo(() => {
    const lines = stackLines();
    const loc = location();
    const stackText =
      lines.length > 0 ? lines.join("\n") : "No stack trace available.";
    return `${entry().message}\n\nLocation: ${loc.component}:${
      loc.line
    }\n\nStack Trace:\n${stackText}\n\nTopic: ${entry().topic}`;
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
        height: windowHeight(),
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: "rgba(24,24,27,1)",
        zIndex: 9999,
      }}
    >
      <StatusBar barStyle="light-content" />
      <View
        style={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 20,
          flex: 1,
          paddingBottom: 32,
        }}
      >
        <View style={{ gap: 6, paddingBottom: 18 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: theme().badgeBg,
                borderWidth: 1,
                borderColor: theme().badgeBorder,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: theme().badgeDot,
                }}
              />
              <Text
                style={{
                  color: theme().badgeText,
                  fontSize: 10,
                  fontWeight: "800",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                {header()}
              </Text>
            </View>

            <Show when={props.navigation && props.navigation.total > 1}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <Button
                  onPress={props.navigation!.onPrev}
                  // disabled={props.navigation!.index === 0}
                  enableGlassIOS
                  rounded="pill"
                  size="sm"
                  style={{
                    opacity: props.navigation!.index === 0 ? 0.3 : 1,
                    backgroundColor: "transparent",
                  }}
                >
                  <SystemGlyph
                    name="RiArrowsArrowLeftSLine"
                    size={24}
                    color={theme().badgeText}
                  />
                </Button>
                <Text
                  style={{
                    color: theme().badgeText,
                    fontSize: 13,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {props.navigation!.index + 1} / {props.navigation!.total}
                </Text>
                <Button
                  onPress={props.navigation!.onNext}
                  enableGlassIOS
                  rounded="pill"
                  size="sm"
                  disabled={
                    props.navigation!.index === props.navigation!.total - 1
                  }
                  style={{
                    backgroundColor: "transparent",
                    opacity:
                      props.navigation!.index === props.navigation!.total - 1
                        ? 0.3
                        : 1,
                  }}
                >
                  <SystemGlyph
                    name="RiArrowsArrowRightSLine"
                    size={24}
                    color={theme().badgeText}
                  />
                </Button>
              </View>
            </Show>
          </View>

          <Text
            style={{
              color: "#fafafa",
              fontSize: 22,
              fontWeight: "700",
              lineHeight: 28,
            }}
          >
            {isError()
              ? "Something went wrong in the app"
              : "Potential performance issue detected"}
          </Text>
          <Text
            style={{
              color: "#a1a1aa",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {isError()
              ? "A JavaScript exception was detected that prevents the app from continuing normally."
              : "This warning indicates a condition that might lead to unexpected behavior or performance degradation."}
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
                  backgroundColor: theme().iconBg,
                }}
              >
                <SystemGlyph
                  name="RiDevelopmentTerminalBoxLine"
                  size={25}
                  color={theme().iconColor}
                  style={{
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                />
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
                    color: theme().messageColor,
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
              <Show when={!isError()}>
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
                    Warning: Check Console
                  </Text>
                </View>
              </Show>
              <Show when={isError()}>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    borderRadius: 10,
                    backgroundColor: "rgba(239,68,68,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.32)",
                  }}
                >
                  <Text
                    style={{
                      color: "#ef4444",
                      fontSize: 10,
                      fontWeight: "800",
                    }}
                  >
                    Unstable State
                  </Text>
                </View>
              </Show>
            </View>
          </View>

          <View style={{ flex: 1, gap: 8 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <SystemGlyph
                name="RiArrowsArrowRightSLine"
                size={12}
                color="#71717a"
                style={{ marginTop: 2 }}
              />
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
                flex: 1,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "#27272a",
                backgroundColor: "rgba(24,24,27,0.7)",
                height: 220,
              }}
            >
              <ScrollView
                style={{
                  paddingVertical: 12,
                  minHeight: 220,
                }}
                contentContainerStyle={{
                  paddingBottom: 12,
                  paddingHorizontal: 12,
                  gap: 6,
                }}
              >
                {stackLines().length > 0 ? (
                  <For each={stackLines()}>
                    {(line, index) => (
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
                          {index() + 1}
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            color: index() === 0 ? "#e4e4e7" : "#a1a1aa",
                            fontSize: 11,
                            fontFamily: "Menlo",
                          }}
                        >
                          {line}
                        </Text>
                      </View>
                    )}
                  </For>
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

      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: 24,
          paddingTop: 28,
          gap: 10,
          backgroundColor: "rgba(24,24,27,0.98)",
          borderTopWidth: 1,
          borderTopColor: "#27272a",
        }}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            onPress={handleCopy}
            enableGlassIOS
            style={{
              flex: 1,
              paddingVertical: 13,
              borderRadius: 16,
              backgroundColor: "#27272a",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 4,
              }}
            >
              <Show when={!copied()}>
                <SystemGlyph
                  name="RiDocumentFileCopyLine"
                  size={18}
                  color="#e4e4e7"
                />
              </Show>
              <Text
                style={{
                  color: "#e4e4e7",
                  fontSize: 13,
                  fontWeight: "700",
                  gap: 4,
                  flexDirection: "row",
                  alignItems: "center",
                }}
              >
                {copied() ? "Copied" : "Copy"}
              </Text>
            </View>
          </Button>

          <Button
            onPress={() => {
              props.onDismiss("ignore", entry());
            }}
            enableGlassIOS
            style={{
              flex: 1,
              paddingVertical: 13,
              borderRadius: 16,
              backgroundColor: "#27272a",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SystemGlyph name="RiSystemCloseLine" size={22} color="#e4e4e7" />
            <Text style={{ color: "#e4e4e7", fontSize: 13, fontWeight: "700" }}>
              {isError() ? "Ignore" : "Close"}
            </Text>
          </Button>
        </View>

        <Show when={isError()}>
          <Button
            onPress={() => {
              props.onDismiss("dismiss", entry());
              reloadApp();
            }}
            enableGlassIOS
            style={{
              width: "100%",
              paddingVertical: 15,
              borderRadius: 18,
              backgroundColor: "#dc2626",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SystemGlyph name="RiSystemRefreshLine" size={22} color="#e4e4e7" />
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "900" }}>
              Reload Application
            </Text>
          </Button>
        </Show>

        <Show when={!isError()}>
          <Button
            onPress={() => {
              if (props.onClear) props.onClear();
            }}
            enableGlassIOS
            style={{
              width: "100%",
              paddingVertical: 15,
              borderRadius: 18,
              backgroundColor: "#ca8a04",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SystemGlyph
              name="RiSystemDeleteBin2Line"
              size={22}
              color="#e4e4e7"
            />
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "900" }}>
              Dismiss All Warnings
            </Text>
          </Button>
        </Show>
      </View>
    </View>
  );
}

function WarningToast(props: {
  count: number;
  lastMessage: string;
  onExpand: () => void;
  onClose: () => void;
}) {
  return (
    <View
      style={{
        position: "absolute",
        bottom: 32,
        left: 20,
        right: 20,
        zIndex: 9998,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingRight: 16,
        backgroundColor: "#242014",
        borderRadius: 48,
        borderWidth: 2,
        borderColor: "#695511",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
      }}
    >
      <Pressable
        onPress={props.onExpand}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          paddingVertical: 16,
          paddingHorizontal: 16,
        }}
      >
        <View
          style={{
            backgroundColor: "#eab308", // bg-yellow-500
            padding: 8,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SystemGlyph name="RiSystemAlertLine" size={16} color="#09090b" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: "#fef08a", // text-yellow-200
            }}
          >
            Performance Warning {props.count > 1 ? `(${props.count})` : ""}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 10,
              color: "rgba(250, 204, 21, 0.8)", // text-yellow-400/80
            }}
          >
            {props.lastMessage}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={props.onClose}
        style={{
          width: 35,
          height: 35,
          alignItems: "center",
          justifyContent: "center",
          padding: 8,
          borderRadius: 999,
          backgroundColor: "rgba(255, 255, 255, 0.12)",
          marginLeft: 8,
        }}
      >
        <SystemGlyph name="RiSystemCloseLine" size={24} color="#facc15" />
      </Pressable>
    </View>
  );
}

function ErrorOverlayLayer() {
  const state = getOverlayState();
  const fatalEntry = state.fatal;
  const warnings = state.warnings;
  const [warningExpanded, setWarningExpanded] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const warningCount = () => warnings().length;
  const currentWarning = createMemo(() => {
    const list = warnings();
    if (list.length === 0) return null;
    if (warningExpanded()) {
      const idx = Math.min(Math.max(0, selectedIndex()), list.length - 1);
      return list[idx];
    }
    return list[list.length - 1] ?? null;
  });

  const showWarnings = () => fatalEntry() == null && warningCount() > 0;

  return (
    <SafeAreaProvider>
      {showWarnings() && currentWarning() ? (
        <Show
          when={warningExpanded()}
          fallback={
            <WarningToast
              count={warningCount()}
              lastMessage={currentWarning()!.message}
              onExpand={() => {
                setSelectedIndex(warnings().length - 1);
                setWarningExpanded(true);
              }}
              onClose={() => state.setWarnings(() => [])}
            />
          }
        >
          <DetailOverlay
            entry={currentWarning()!}
            onDismiss={() => setWarningExpanded(false)}
            onClear={() => {
              setWarningExpanded(false);
              state.setWarnings(() => []);
            }}
            navigation={{
              index: Math.min(
                Math.max(0, selectedIndex()),
                warnings().length - 1,
              ),
              total: warnings().length,
              onPrev: () => setSelectedIndex((i) => Math.max(0, i - 1)),
              onNext: () =>
                setSelectedIndex((i) => Math.min(warnings().length - 1, i + 1)),
            }}
          />
        </Show>
      ) : null}

      {fatalEntry() ? (
        <DetailOverlay
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
    </SafeAreaProvider>
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
