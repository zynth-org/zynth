import {
  Image,
  View,
  type ImageErrorEvent,
  type ImageSource,
  type ViewProps,
} from "@zynthjs/components";
import { createEffect, createMemo, createSignal, For, type JSX, type ParentComponent } from "solid-js";
import type { StyleProp } from "@zynthjs/core";
import { generateQRCodeMatrix, type QRErrorCorrectionLevel } from "./qr";
import { generateNativeQRCodeSync, isNativeAvailable } from "../native";

interface QRSegment {
  x: number;
  y: number;
  length: number;
}

type QRRenderState = "idle" | "loading" | "ready" | "error";

type NativeImageSource = {
  data: string;
  mimeType: string;
};

type NativeResolveResult =
  | {
      mode: "unavailable";
    }
  | {
      mode: "error";
      message: string;
    }
  | {
      mode: "payload";
      source: NativeImageSource;
      key: string;
    };

export interface QRCodeProps extends ViewProps {
  /** Raw content to encode in the QR payload (UTF-8 byte mode). */
  value: string;
  /** Target square size in logical pixels. */
  size?: number;
  /** Dark module color. */
  color?: string;
  /** Light module color. */
  backgroundColor?: string;
  /** Quiet zone in module units. */
  quietZone?: number;
  /** Error correction level. */
  level?: QRErrorCorrectionLevel;
  /** Optional lower bound for auto version selection. */
  minVersion?: number;
  /** Optional upper bound for auto version selection (max 10 in current implementation). */
  maxVersion?: number;
  /** Optional centered logo source rendered on top of the QR. */
  logoSource?: ImageSource;
  /** Logo size ratio relative to QR box size (0..1). */
  logoScale?: number;
  /** Fixed logo size in pixels. Overrides `logoScale` when provided. */
  logoSize?: number;
  /** Padding around logo in pixels. */
  logoPadding?: number;
  /** Background color behind logo. */
  logoBackgroundColor?: string;
  /** Border radius for logo container. */
  logoBorderRadius?: number;
  /** Keep previous native frame visible while a new frame is preparing. */
  keepPreviousOnUpdate?: boolean;
  /** Called when loading state changes. */
  onLoadingChange?: (loading: boolean) => void;
  /** Called when render state changes. */
  onRenderStateChange?: (state: QRRenderState) => void;
  /** Called when an internal render error occurs. */
  onRenderError?: (message: string) => void;
  /** Optional loading placeholder (used when preparing first native frame). */
  loadingFallback?: JSX.Element;
  /** Optional error placeholder (used when no renderable frame is available). */
  errorFallback?: (message: string) => JSX.Element;
  /**
   * Allow JS vector fallback even when native generation fails.
   * Keep disabled for production performance diagnostics on native targets.
   */
  allowJsFallbackOnNativeError?: boolean;
}

const DEFAULT_SIZE = 192;
const DEFAULT_QUIET_ZONE = 4;
const DEFAULT_LOGO_PADDING = 6;

const MAX_LOGO_SCALE_BY_LEVEL: Record<QRErrorCorrectionLevel, number> = {
  L: 0.08,
  M: 0.12,
  Q: 0.16,
  H: 0.22,
};

const withQuietZone = (matrix: Array<Array<boolean>>, quietZone: number): Array<Array<boolean>> => {
  const moduleCount = matrix.length;
  const paddedCount = moduleCount + quietZone * 2;
  const padded: Array<Array<boolean>> = [];

  for (let row = 0; row < paddedCount; row += 1) {
    const line: Array<boolean> = [];
    for (let col = 0; col < paddedCount; col += 1) {
      const sourceRow = row - quietZone;
      const sourceCol = col - quietZone;
      if (sourceRow >= 0 && sourceRow < moduleCount && sourceCol >= 0 && sourceCol < moduleCount) {
        line.push(matrix[sourceRow][sourceCol]);
      } else {
        line.push(false);
      }
    }
    padded.push(line);
  }

  return padded;
};

const buildRowSegments = (matrix: Array<Array<boolean>>): Array<QRSegment> => {
  const segments: Array<QRSegment> = [];
  for (let y = 0; y < matrix.length; y += 1) {
    const row = matrix[y];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      segments.push({ x: start, y, length: x - start });
    }
  }
  return segments;
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Unknown QR render error";
};

const createNativeKey = (source: NativeImageSource): string => {
  const prefix = source.data.slice(0, 32);
  return `${source.mimeType}:${source.data.length}:${prefix}`;
};

const parseNativePayload = (payload: unknown): NativeImageSource | null => {
  if (typeof payload === "string" && payload.length > 0) {
    return {
      data: payload,
      mimeType: "image/png",
    };
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const imageData =
    typeof record.imageData === "string"
      ? record.imageData
      : (typeof record.data === "string" ? record.data : null);
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : "image/png";
  if (!imageData || imageData.length === 0) {
    return null;
  }
  return {
    data: imageData,
    mimeType,
  };
};

export const QRCode: ParentComponent<QRCodeProps> = (props) => {
  const nativeBridgeAvailable = isNativeAvailable();

  const [displayedNativeSource, setDisplayedNativeSource] = createSignal<NativeImageSource | null>(null);
  const [displayedNativeKey, setDisplayedNativeKey] = createSignal("");
  const [stagedNativeSource, setStagedNativeSource] = createSignal<NativeImageSource | null>(null);
  const [stagedNativeKey, setStagedNativeKey] = createSignal("");
  const [decodeFailedNativeKey, setDecodeFailedNativeKey] = createSignal("");
  const [renderState, setRenderState] = createSignal<QRRenderState>("idle");
  const [renderError, setRenderError] = createSignal<string | null>(null);

  const qrMatrix = createMemo(() => {
    const quietZone = Math.max(0, Math.floor(props.quietZone ?? DEFAULT_QUIET_ZONE));
    const matrix = generateQRCodeMatrix({
      value: props.value,
      level: props.level,
      minVersion: props.minVersion,
      maxVersion: props.maxVersion,
    });
    return withQuietZone(matrix, quietZone);
  });

  const moduleCount = createMemo(() => qrMatrix().length);
  const boxSize = createMemo(() => {
    const rawSize = props.size ?? DEFAULT_SIZE;
    return Math.max(1, Math.round(rawSize));
  });
  const level = createMemo(() => props.level ?? "M");

  const modulePixelSize = createMemo(() => {
    return Math.max(1, Math.floor(boxSize() / moduleCount()));
  });

  const drawSize = createMemo(() => modulePixelSize() * moduleCount());
  const drawOffset = createMemo(() => Math.max(0, Math.floor((boxSize() - drawSize()) / 2)));
  const segments = createMemo(() => buildRowSegments(qrMatrix()));

  const nativeResolveResult = createMemo<NativeResolveResult>(() => {
    if (!nativeBridgeAvailable) {
      return { mode: "unavailable" };
    }
    try {
      const payload = generateNativeQRCodeSync({
        matrix: qrMatrix(),
        size: boxSize(),
        color: props.color,
        backgroundColor: props.backgroundColor,
      });
      const source = parseNativePayload(payload);
      if (!source) {
        return { mode: "error", message: "Native QR payload is empty." };
      }
      return {
        mode: "payload",
        source,
        key: createNativeKey(source),
      };
    } catch (error) {
      return {
        mode: "error",
        message: extractErrorMessage(error),
      };
    }
  });

  createEffect(() => {
    const result = nativeResolveResult();

    if (result.mode === "unavailable") {
      setStagedNativeSource(null);
      setStagedNativeKey("");
      setDecodeFailedNativeKey("");
      setRenderError(null);
      setRenderState("ready");
      return;
    }

    if (result.mode === "error") {
      setStagedNativeSource(null);
      setStagedNativeKey("");
      setRenderError(result.message);
      setRenderState(displayedNativeSource() ? "ready" : "error");
      return;
    }

    if (result.key === decodeFailedNativeKey()) {
      setRenderError("Failed to decode native QR image.");
      setRenderState(displayedNativeSource() ? "ready" : "error");
      return;
    }

    if (result.key === displayedNativeKey() || result.key === stagedNativeKey()) {
      if (displayedNativeSource()) {
        setRenderError(null);
        setRenderState("ready");
      }
      return;
    }

    const keepPrevious = props.keepPreviousOnUpdate ?? true;
    if (!keepPrevious) {
      setDisplayedNativeSource(null);
      setDisplayedNativeKey("");
    }

    setStagedNativeSource(result.source);
    setStagedNativeKey(result.key);
    setRenderError(null);
    setRenderState("loading");
  });

  createEffect(() => {
    props.onLoadingChange?.(renderState() === "loading");
  });

  createEffect(() => {
    props.onRenderStateChange?.(renderState());
  });

  createEffect(() => {
    const message = renderError();
    if (message) {
      props.onRenderError?.(message);
    }
  });

  const promoteStagedNativeSource = () => {
    const staged = stagedNativeSource();
    const stagedKey = stagedNativeKey();
    if (!staged || stagedKey.length === 0) {
      return;
    }

    setDisplayedNativeSource(staged);
    setDisplayedNativeKey(stagedKey);
    setStagedNativeSource(null);
    setStagedNativeKey("");
    setDecodeFailedNativeKey("");
    setRenderError(null);
    setRenderState("ready");
  };

  const handleStagedNativeError = (event: ImageErrorEvent) => {
    const failedKey = stagedNativeKey();
    if (failedKey.length > 0) {
      setDecodeFailedNativeKey(failedKey);
    }

    setStagedNativeSource(null);
    setStagedNativeKey("");

    const message = event.message ?? "Failed to decode native QR image.";
    setRenderError(message);
    setRenderState(displayedNativeSource() ? "ready" : "error");
  };

  const wrapperStyle = createMemo<StyleProp>(() => {
    const base: StyleProp = {
      width: boxSize(),
      height: boxSize(),
      backgroundColor: props.backgroundColor ?? "#ffffff",
      position: "relative",
      overflow: "hidden",
    };
    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    if (userStyle == null) {
      return base;
    }
    return [base, userStyle] as StyleProp;
  });

  const logoSize = createMemo(() => {
    if (!props.logoSource) {
      return 0;
    }

    const maxScale = MAX_LOGO_SCALE_BY_LEVEL[level()];
    const explicit = props.logoSize;
    if (explicit != null) {
      return Math.max(0, Math.min(Math.round(explicit), Math.floor(boxSize() * maxScale)));
    }

    const requestedScale = props.logoScale ?? Math.min(0.2, maxScale);
    const safeScale = Math.max(0, Math.min(requestedScale, maxScale));
    return Math.max(0, Math.floor(boxSize() * safeScale));
  });

  const logoPadding = createMemo(() => {
    return Math.max(0, Math.round(props.logoPadding ?? DEFAULT_LOGO_PADDING));
  });

  const logoContainerSize = createMemo(() => {
    const currentLogoSize = logoSize();
    if (currentLogoSize <= 0) {
      return 0;
    }
    return currentLogoSize + logoPadding() * 2;
  });

  const logoPosition = createMemo(() => {
    const containerSize = logoContainerSize();
    if (containerSize <= 0) {
      return 0;
    }
    return Math.max(0, Math.floor((boxSize() - containerSize) / 2));
  });

  const renderVectorFallback = createMemo(() => {
    if (!nativeBridgeAvailable) {
      return true;
    }
    if (
      (props.allowJsFallbackOnNativeError ?? false) &&
      renderState() === "error" &&
      !displayedNativeSource()
    ) {
      return true;
    }
    return false;
  });

  const shouldShowLoadingFallback = createMemo(() => {
    return renderState() === "loading" && !displayedNativeSource();
  });

  const shouldShowErrorFallback = createMemo(() => {
    return renderState() === "error" && !displayedNativeSource() && renderError() != null;
  });

  return (
    <View
      style={wrapperStyle}
      onPress={props.onPress}
      onLayout={props.onLayout}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      accessibilityRole={props.accessibilityRole}
      pointerEvents={props.pointerEvents}
      enableGlassIOS={props.enableGlassIOS}
      tintColor={props.tintColor}
      testID={props.testID}
      layout={props.layout}
    >
      {displayedNativeSource() ? (
        <Image
          source={displayedNativeSource()!}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: boxSize(),
            height: boxSize(),
          }}
          resizeMode="contain"
        />
      ) : null}

      {stagedNativeSource() ? (
        <Image
          source={stagedNativeSource()!}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: boxSize(),
            height: boxSize(),
            opacity: displayedNativeSource() ? 0 : 1,
          }}
          resizeMode="contain"
          onLoad={promoteStagedNativeSource}
          onError={handleStagedNativeError}
        />
      ) : null}

      {renderVectorFallback() ? (
        <For each={segments()}>
          {(segment) => (
            <View
              style={{
                position: "absolute",
                left: drawOffset() + segment.x * modulePixelSize(),
                top: drawOffset() + segment.y * modulePixelSize(),
                width: segment.length * modulePixelSize(),
                height: modulePixelSize(),
                backgroundColor: props.color ?? "#000000",
              }}
              pointerEvents="none"
            />
          )}
        </For>
      ) : null}

      {shouldShowLoadingFallback() && props.loadingFallback ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: boxSize(),
            height: boxSize(),
            alignItems: "center",
            justifyContent: "center",
          }}
          pointerEvents="none"
        >
          {props.loadingFallback}
        </View>
      ) : null}

      {shouldShowErrorFallback() ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: boxSize(),
            height: boxSize(),
            alignItems: "center",
            justifyContent: "center",
          }}
          pointerEvents="none"
        >
          {props.errorFallback ? props.errorFallback(renderError() ?? "QR render error") : null}
        </View>
      ) : null}

      {props.logoSource && logoSize() > 0 ? (
        <View
          style={{
            position: "absolute",
            left: logoPosition(),
            top: logoPosition(),
            width: logoContainerSize(),
            height: logoContainerSize(),
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: props.logoBackgroundColor ?? (props.backgroundColor ?? "#ffffff"),
            borderRadius: props.logoBorderRadius ?? Math.floor(logoContainerSize() * 0.24),
            overflow: "hidden",
          }}
          pointerEvents="none"
        >
          <Image
            source={props.logoSource}
            style={{
              width: logoSize(),
              height: logoSize(),
            }}
            resizeMode="contain"
          />
        </View>
      ) : null}

      {props.children}
    </View>
  );
};
