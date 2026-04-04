#include <jni.h>
#include <android/log.h>
#include <fbjni/fbjni.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>

#include "UICommandsRegistry.h"
#include "ZynthJSIPluginRegistry.h"
#include "ZynthYogaLayoutRuntime.h"
#include "axon_ffi.h"

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <atomic>
#include <cstring>
#include <cstdint>
#include <signal.h>
#include <thread>
#include <unistd.h>
#include <vector>
#include <limits>
#include <algorithm>
#include <cctype>
#include <cmath>

using namespace facebook::jsi;

#ifndef ZYNTH_LAYOUT_ENGINE_AXON
#define ZYNTH_LAYOUT_ENGINE_AXON 0
#endif

#ifndef ZYNTH_LAYOUT_ENGINE_YOGA
#define ZYNTH_LAYOUT_ENGINE_YOGA 0
#endif

namespace {
JavaVM *gVm = nullptr;
int gCrashPipe[2] = {-1, -1};
std::atomic<bool> gCrashHandlerInstalled{false};
std::atomic<bool> gCrashThreadStarted{false};
jclass gDevtoolsClass = nullptr;
jmethodID gDevtoolsEmitMethod = nullptr;
jclass gNativeOverlayClass = nullptr;
jmethodID gNativeOverlayHandleRawMethod = nullptr;
std::mutex gPluginMutex;
std::vector<ZynthJSIPluginInstaller> gPluginInstallers;
std::vector<ZynthSharedSignalChangedCallback> gSharedSignalCallbacks;

struct TimerEntry {
  std::shared_ptr<Function> callback;
  std::vector<Value> args;
  bool repeat;
};

struct TimerContext {
  std::atomic<int> nextTimerId{1};
  std::mutex mutex;
  std::unordered_map<int, TimerEntry> timers;
};

struct ZynthWorkletClosureValue {
  enum class Kind {
    Shared,
    Number,
    Bool,
    String,
  };
  std::string name;
  Kind kind = Kind::Number;
  int sharedId = 0;
  double numberValue = 0.0;
  bool boolValue = false;
  std::string stringValue;
};

struct ZynthWorkletDefinition {
  std::string code;
  std::string location;
  std::vector<ZynthWorkletClosureValue> closure;
};

struct RuntimeState {
  enum class AxonTextMeasureMode {
    Java = 0,
    Fallback = 1,
  };
  struct AxonFallbackFontMetrics {
    float sizePx = 16.0f;
    float lineHeightPx = 20.0f;
    float avgAdvancePx = 8.8f;
  };
  facebook::hermes::HermesRuntime *runtime = nullptr;
  EngineBase *axonEngine = nullptr;
  ZynthYogaLayoutRuntime *yogaRuntime = nullptr;
  std::unordered_map<int, std::size_t> axonNodes;
  std::unordered_map<std::uint32_t, AxonFallbackFontMetrics> axonFallbackFonts;
  std::unordered_map<int, std::string> nodeTypes;
  int activeSurfaceId = 0;
  float density = 1.0f;
  std::uint32_t axonDefaultFontId = UINT32_MAX;
  AxonTextMeasureMode axonTextMeasureMode = AxonTextMeasureMode::Java;
  jobject uiManager = nullptr;
  jclass uiClass = nullptr;
  jclass jsBridgeClass = nullptr;
  jclass devtoolsClass = nullptr;
  jclass nativeOverlayClass = nullptr;
  jmethodID createNode = nullptr;
  jmethodID setProp = nullptr;
  jmethodID setText = nullptr;
  jmethodID syncTextInputState = nullptr;
  jmethodID insertChild = nullptr;
  jmethodID removeChild = nullptr;
  jmethodID setHandler = nullptr;
  jmethodID setInputHandler = nullptr;
  jmethodID clearInputHandler = nullptr;
  jmethodID applyBatch = nullptr;
  jmethodID applyBatchTypedPacked = nullptr;
  jmethodID applyBatchTypedBuffer = nullptr;
  jmethodID beginAtomicCommit = nullptr;
  jmethodID endAtomicCommit = nullptr;
  jmethodID setSurface = nullptr;
  jmethodID flush = nullptr;
  jmethodID scheduleTimer = nullptr;
  jmethodID cancelTimer = nullptr;
  jmethodID scheduleAnimationFrame = nullptr;
  jmethodID cancelAnimationFrame = nullptr;
  jmethodID applyAnimatedStyle = nullptr;
  jmethodID applyAnimatedLayoutStyle = nullptr;
  jmethodID axonRegisterResolvedFont = nullptr;
  jmethodID axonMeasureText = nullptr;
  jmethodID axonMeasureNode = nullptr;
  jmethodID yogaMeasureTextNode = nullptr;
  jmethodID axonDensity = nullptr;
  jmethodID noteAxonMetricsBatch = nullptr;
  jmethodID postRegisterWorklet = nullptr;
  jmethodID postRunWorklet = nullptr;
  jmethodID devtoolsEmit = nullptr;
  jmethodID devtoolsIsConnected = nullptr;
  jmethodID nativeOverlayHandleRaw = nullptr;
  jobject moduleRegistry = nullptr;
  jclass moduleRegistryClass = nullptr;
  jmethodID moduleCall = nullptr;
  jmethodID moduleCallSync = nullptr;
  jclass jsonObjectClass = nullptr;
  jmethodID jsonObjectConstructor = nullptr;
  jclass doubleClass = nullptr;
  jmethodID doubleConstructor = nullptr;
  jclass booleanClass = nullptr;
  jmethodID booleanConstructor = nullptr;
  jclass stringClass = nullptr;
  std::shared_ptr<TimerContext> timerContext = std::make_shared<TimerContext>();
  std::shared_ptr<facebook::hermes::HermesRuntime> uiRuntime;
  std::atomic<int> nextWorkletId{1};
  std::unordered_map<int, std::shared_ptr<Function>> uiWorklets;
  std::unordered_map<int, std::vector<struct ZynthWorkletClosureValue>> uiWorkletClosures;
  std::unordered_map<int, struct ZynthWorkletDefinition> pendingWorklets;
  std::mutex workletMutex;
  std::atomic<int> nextSharedSignalId{1};
  std::unordered_map<int, double> sharedSignals;
  std::mutex sharedSignalsMutex;
  std::atomic<int> nextSyncSignalId{1};
  std::unordered_map<int, std::string> syncSignals;
  std::mutex syncSignalsMutex;
  std::unordered_map<int, int> syncSignalBindings; // nodeId -> signalId
  std::mutex syncSignalBindingsMutex;
};

std::mutex gStateMutex;
std::unordered_map<facebook::hermes::HermesRuntime *, std::shared_ptr<RuntimeState>> gStates;

struct HandlerKey {
  facebook::hermes::HermesRuntime *runtime;
  int nodeId;
  std::string name;

  bool operator==(const HandlerKey &other) const {
    return runtime == other.runtime && nodeId == other.nodeId && name == other.name;
  }
};

struct HandlerKeyHash {
  size_t operator()(const HandlerKey &key) const {
    size_t h0 = std::hash<uintptr_t>()(reinterpret_cast<uintptr_t>(key.runtime));
    size_t h1 = std::hash<int>()(key.nodeId);
    size_t h2 = std::hash<std::string>()(key.name);
    return h0 ^ (h1 << 1) ^ (h2 << 2);
  }
};

struct HandlerEntry {
  facebook::hermes::HermesRuntime *runtime = nullptr;
  std::shared_ptr<Function> handler;
};

std::mutex gHandlerMutex;
std::unordered_map<HandlerKey, HandlerEntry, HandlerKeyHash> gHandlers;

void removeHandlersForNode(facebook::hermes::HermesRuntime *runtime, int nodeId) {
  std::lock_guard<std::mutex> lock(gHandlerMutex);
  for (auto it = gHandlers.begin(); it != gHandlers.end();) {
    if (it->first.runtime == runtime && it->first.nodeId == nodeId) {
      it = gHandlers.erase(it);
    } else {
      ++it;
    }
  }
}

JNIEnv *getEnv() {
  return facebook::jni::Environment::current();
}

void callSetProp(JNIEnv *env, RuntimeState *state, jint nodeId, const std::string &name,
                 const std::string &value) {
  jstring jName = env->NewStringUTF(name.c_str());
  jstring jValue = env->NewStringUTF(value.c_str());
  env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
  env->DeleteLocalRef(jName);
  env->DeleteLocalRef(jValue);
}

std::optional<std::uint32_t> axonPropIdForName(const std::string &name) {
  if (name == "width") return 1;
  if (name == "height") return 2;
  if (name == "minWidth") return 3;
  if (name == "minHeight") return 4;
  if (name == "maxWidth") return 5;
  if (name == "maxHeight") return 6;
  if (name == "flex") return 7;
  if (name == "flexGrow") return 8;
  if (name == "flexShrink") return 9;
  if (name == "flexBasis") return 10;
  if (name == "top") return 11;
  if (name == "right") return 12;
  if (name == "bottom") return 13;
  if (name == "left") return 14;
  if (name == "padding") return 15;
  if (name == "paddingHorizontal") return 16;
  if (name == "paddingVertical") return 17;
  if (name == "paddingTop") return 18;
  if (name == "paddingRight") return 19;
  if (name == "paddingBottom") return 20;
  if (name == "paddingLeft") return 21;
  if (name == "margin") return 22;
  if (name == "marginHorizontal") return 23;
  if (name == "marginVertical") return 24;
  if (name == "marginTop") return 25;
  if (name == "marginRight") return 26;
  if (name == "marginBottom") return 27;
  if (name == "marginLeft") return 28;
  if (name == "gap") return 29;
  if (name == "rowGap") return 30;
  if (name == "columnGap") return 31;
  if (name == "aspectRatio") return 32;
  if (name == "flexDirection") return 33;
  if (name == "justifyContent") return 34;
  if (name == "alignItems") return 35;
  if (name == "alignSelf") return 36;
  if (name == "alignContent") return 37;
  if (name == "flexWrap") return 38;
  if (name == "position") return 39;
  if (name == "display") return 40;
  if (name == "overflow") return 41;
  if (name == "direction") return 114;
  return std::nullopt;
}

std::size_t axonEnsureNode(RuntimeState *state, int nodeId) {
  if (!state || !state->axonEngine) return std::numeric_limits<std::size_t>::max();
  auto it = state->axonNodes.find(nodeId);
  if (it != state->axonNodes.end()) {
    return it->second;
  }
  std::size_t nativeId = axon_node_create(state->axonEngine, nullptr);
  state->axonNodes[nodeId] = nativeId;
  return nativeId;
}

int axonResolveTreeNodeId(RuntimeState *state, int nodeId) {
  if (!state) return nodeId;
  if (nodeId == 0 && state->activeSurfaceId != 0) {
    return state->activeSurfaceId;
  }
  return nodeId;
}

bool axonIsInlineTextChild(RuntimeState *state, int parentId, int childId) {
  if (!state) return false;
  parentId = axonResolveTreeNodeId(state, parentId);
  childId = axonResolveTreeNodeId(state, childId);
  auto parentIt = state->nodeTypes.find(parentId);
  auto childIt = state->nodeTypes.find(childId);
  if (parentIt == state->nodeTypes.end() || childIt == state->nodeTypes.end()) {
    return false;
  }
  return parentIt->second == "text" && childIt->second == "text";
}

bool axonPropUsesDp(std::uint32_t prop_id) {
  switch (prop_id) {
    case 1:   // width
    case 2:   // height
    case 3:   // minWidth
    case 4:   // minHeight
    case 5:   // maxWidth
    case 6:   // maxHeight
    case 10:  // flexBasis
    case 11:  // top
    case 12:  // right
    case 13:  // bottom
    case 14:  // left
    case 15:  // padding
    case 16:  // paddingHorizontal
    case 17:  // paddingVertical
    case 18:  // paddingTop
    case 19:  // paddingRight
    case 20:  // paddingBottom
    case 21:  // paddingLeft
    case 22:  // margin
    case 23:  // marginHorizontal
    case 24:  // marginVertical
    case 25:  // marginTop
    case 26:  // marginRight
    case 27:  // marginBottom
    case 28:  // marginLeft
    case 29:  // gap
    case 30:  // rowGap
    case 31:  // columnGap
    case 47:  // borderRadius
    case 48:  // borderWidth
    case 49:  // borderTopWidth
    case 50:  // borderRightWidth
    case 51:  // borderBottomWidth
    case 52:  // borderLeftWidth
    case 53:  // borderTopLeftRadius
    case 54:  // borderTopRightRadius
    case 55:  // borderBottomRightRadius
    case 56:  // borderBottomLeftRadius
    case 58:  // fontSize
    case 70:  // shadowRadius
    case 73:  // lineHeight
    case 74:  // lineSpacing
    case 75:  // paragraphSpacing
    case 76:  // letterSpacing
    case 79:  // minimumFontScale
    case 80:  // baselineShift
      return true;
    default:
      return false;
  }
}

float axonScaleNumberValue(RuntimeState *state, std::uint32_t prop_id, float value) {
  if (!axonPropUsesDp(prop_id)) {
    return value;
  }
  const float density = (state && std::isfinite(state->density) && state->density > 0.0f)
                            ? state->density
                            : 1.0f;
  return value * density;
}

void axonMirrorSetText(RuntimeState *state, int nodeId, const std::string &text) {
  if (!state || !state->axonEngine) return;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  std::size_t nativeId = axonEnsureNode(state, nodeId);
  if (nativeId == std::numeric_limits<std::size_t>::max()) return;
  if (state->axonDefaultFontId == UINT32_MAX) {
    const float default_font_size_px =
        ((std::isfinite(state->density) && state->density > 0.0f) ? state->density : 1.0f) * 16.0f;
    state->axonDefaultFontId =
        axon_font_register_resolved(state->axonEngine, "sans-serif", 400, false, default_font_size_px);
    if (state->axonDefaultFontId != UINT32_MAX) {
      state->axonFallbackFonts[state->axonDefaultFontId] = RuntimeState::AxonFallbackFontMetrics{
          default_font_size_px,
          std::max(default_font_size_px * 1.3f, 1.0f),
          std::max(default_font_size_px * 0.55f, 1.0f),
      };
    }
  }
  if (state->axonDefaultFontId == UINT32_MAX) return;
  axon_node_set_measure_text(state->axonEngine, nativeId, text.c_str(), state->axonDefaultFontId);
}

void axonMirrorSetProp(RuntimeState *state, int nodeId, const std::string &name, const Value &value,
                       Runtime &rt) {
  if (!state || !state->axonEngine) return;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  auto propId = axonPropIdForName(name);
  if (!propId.has_value()) return;
  std::size_t nativeId = axonEnsureNode(state, nodeId);
  if (nativeId == std::numeric_limits<std::size_t>::max()) return;
  if (value.isNumber()) {
    const float raw = static_cast<float>(value.asNumber());
    const float scaled = axonScaleNumberValue(state, *propId, raw);
    axon_node_style_set_number(state->axonEngine, nativeId, *propId, scaled);
    return;
  }
  if (value.isString()) {
    std::string text = value.asString(rt).utf8(rt);
    axon_node_style_set_string(state->axonEngine, nativeId, *propId, text.c_str());
    return;
  }
  if (value.isBool()) {
    const char *text = value.getBool() ? "true" : "false";
    axon_node_style_set_string(state->axonEngine, nativeId, *propId, text);
  }
}

void axonMirrorInsertChild(RuntimeState *state, int parentId, int childId, int index) {
  if (!state || !state->axonEngine) return;
  if (axonIsInlineTextChild(state, parentId, childId)) {
    return;
  }
  parentId = axonResolveTreeNodeId(state, parentId);
  childId = axonResolveTreeNodeId(state, childId);
  std::size_t parentNative = axonEnsureNode(state, parentId);
  std::size_t childNative = axonEnsureNode(state, childId);
  if (parentNative == std::numeric_limits<std::size_t>::max() ||
      childNative == std::numeric_limits<std::size_t>::max()) {
    return;
  }
  axon_node_insert_child(state->axonEngine, parentNative, childNative, static_cast<std::size_t>(std::max(index, 0)));
}

void axonMirrorRemoveChild(RuntimeState *state, int parentId, int childId) {
  if (!state || !state->axonEngine) return;
  if (axonIsInlineTextChild(state, parentId, childId)) {
    return;
  }
  parentId = axonResolveTreeNodeId(state, parentId);
  childId = axonResolveTreeNodeId(state, childId);
  auto parentIt = state->axonNodes.find(parentId);
  auto childIt = state->axonNodes.find(childId);
  if (parentIt == state->axonNodes.end() || childIt == state->axonNodes.end()) return;
  axon_node_remove_child(state->axonEngine, parentIt->second, childIt->second);
}

void axonMirrorDropNode(RuntimeState *state, int nodeId) {
  if (!state) return;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  state->axonNodes.erase(nodeId);
  state->nodeTypes.erase(nodeId);
}

bool axonComputeLayoutForRoot(RuntimeState *state, int rootId, float width, float height) {
  if (!state || !state->axonEngine) return false;
  rootId = axonResolveTreeNodeId(state, rootId);
  std::size_t nativeId = axonEnsureNode(state, rootId);
  if (nativeId == std::numeric_limits<std::size_t>::max()) return false;
  return axon_compute_layout(state->axonEngine, nativeId, width, height);
}

bool axonSetStyleNumberForNode(RuntimeState *state, int nodeId, std::uint32_t propId, float value) {
  if (!state || !state->axonEngine) return false;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  std::size_t nativeId = axonEnsureNode(state, nodeId);
  if (nativeId == std::numeric_limits<std::size_t>::max()) return false;
  return axon_node_style_set_number(state->axonEngine, nativeId, propId, value);
}

bool axonSetStyleStringForNode(RuntimeState *state, int nodeId, std::uint32_t propId, const std::string &value) {
  if (!state || !state->axonEngine) return false;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  std::size_t nativeId = axonEnsureNode(state, nodeId);
  if (nativeId == std::numeric_limits<std::size_t>::max()) return false;
  return axon_node_style_set_string(state->axonEngine, nativeId, propId, value.c_str());
}

bool axonMeasureTextWithJava(
    void *user_data,
    std::uint32_t font_id,
    const std::uint8_t *text,
    std::size_t len,
    bool is_vertical,
    AxonTextMetrics *out_metrics) {
  auto *state = reinterpret_cast<RuntimeState *>(user_data);
  if (!state || !state->uiManager || !state->axonMeasureText || !text || !out_metrics) {
    return false;
  }
  if (state->axonTextMeasureMode == RuntimeState::AxonTextMeasureMode::Fallback) {
    auto metricsIt = state->axonFallbackFonts.find(font_id);
    RuntimeState::AxonFallbackFontMetrics metrics =
        metricsIt != state->axonFallbackFonts.end()
            ? metricsIt->second
            : RuntimeState::AxonFallbackFontMetrics{};
    const float lineHeight = std::max(metrics.lineHeightPx, 1.0f);
    float width = 0.0f;
    std::size_t visibleCount = 0;
    bool inWhitespaceRun = false;
    for (std::size_t i = 0; i < len; i++) {
      unsigned char ch = text[i];
      if (ch == '\n' || ch == '\r') {
        inWhitespaceRun = false;
        continue;
      }
      const bool isWhitespace = std::isspace(ch) != 0;
      if (isWhitespace) {
        if (!inWhitespaceRun) {
          width += metrics.avgAdvancePx * 0.5f;
          inWhitespaceRun = true;
        }
        continue;
      }
      inWhitespaceRun = false;
      visibleCount += 1;
      width += metrics.avgAdvancePx;
    }
    if (visibleCount == 0 && len > 0) {
      width = metrics.avgAdvancePx * 0.5f;
    }
    out_metrics->width = is_vertical ? lineHeight : width;
    out_metrics->height = is_vertical ? width : lineHeight;
    return true;
  }
  JNIEnv *env = getEnv();
  if (!env) return false;
  std::string utf8(reinterpret_cast<const char *>(text), len);
  jstring jText = env->NewStringUTF(utf8.c_str());
  jobject result = env->CallObjectMethod(
      state->uiManager,
      state->axonMeasureText,
      static_cast<jint>(font_id),
      jText,
      static_cast<jboolean>(is_vertical));
  env->DeleteLocalRef(jText);
  if (!result) return false;
  auto *array = reinterpret_cast<jfloatArray>(result);
  if (env->GetArrayLength(array) < 2) {
    env->DeleteLocalRef(result);
    return false;
  }
  jfloat values[2] = {0.0f, 0.0f};
  env->GetFloatArrayRegion(array, 0, 2, values);
  env->DeleteLocalRef(result);
  out_metrics->width = values[0];
  out_metrics->height = values[1];
  return true;
}

bool axonMeasureNodeWithJava(
    void *user_data,
    std::uint32_t node_id,
    float width,
    std::uint32_t width_mode,
    float height,
    std::uint32_t height_mode,
    AxonTextMetrics *out_metrics) {
  auto *state = reinterpret_cast<RuntimeState *>(user_data);
  if (!state || !state->uiManager || !state->axonMeasureNode || !out_metrics) {
    return false;
  }
  JNIEnv *env = getEnv();
  if (!env) return false;
  jobject result = env->CallObjectMethod(
      state->uiManager,
      state->axonMeasureNode,
      static_cast<jint>(node_id),
      width,
      static_cast<jint>(width_mode),
      height,
      static_cast<jint>(height_mode));
  if (!result) return false;
  auto *array = reinterpret_cast<jfloatArray>(result);
  if (env->GetArrayLength(array) < 2) {
    env->DeleteLocalRef(result);
    return false;
  }
  jfloat values[2] = {0.0f, 0.0f};
  env->GetFloatArrayRegion(array, 0, 2, values);
  env->DeleteLocalRef(result);
  out_metrics->width = values[0];
  out_metrics->height = values[1];
  return true;
}

bool yogaMeasureTextWithJava(
    void *user_data,
    int nodeId,
    float width,
    int widthMode,
    float height,
    int heightMode,
    float *outWidth,
    float *outHeight) {
  auto *state = reinterpret_cast<RuntimeState *>(user_data);
  if (!state || !state->uiManager || !state->yogaMeasureTextNode || !outWidth || !outHeight) {
    return false;
  }
  JNIEnv *env = getEnv();
  if (!env) return false;
  jobject result = env->CallObjectMethod(
      state->uiManager,
      state->yogaMeasureTextNode,
      static_cast<jint>(nodeId),
      static_cast<jfloat>(width),
      static_cast<jint>(widthMode),
      static_cast<jfloat>(height),
      static_cast<jint>(heightMode));
  if (!result) return false;
  auto *array = reinterpret_cast<jfloatArray>(result);
  if (env->GetArrayLength(array) < 2) {
    env->DeleteLocalRef(array);
    return false;
  }
  jfloat values[2] = {0.0f, 0.0f};
  env->GetFloatArrayRegion(array, 0, 2, values);
  env->DeleteLocalRef(array);
  *outWidth = values[0];
  *outHeight = values[1];
  return true;
}

bool yogaMeasureNodeWithJava(
    void *user_data,
    int nodeId,
    float width,
    int widthMode,
    float height,
    int heightMode,
    float *outWidth,
    float *outHeight) {
  auto *state = reinterpret_cast<RuntimeState *>(user_data);
  if (!state || !state->uiManager || !state->axonMeasureNode || !outWidth || !outHeight) {
    return false;
  }
  JNIEnv *env = getEnv();
  if (!env) return false;
  jobject result = env->CallObjectMethod(
      state->uiManager,
      state->axonMeasureNode,
      static_cast<jint>(nodeId),
      static_cast<jfloat>(width),
      static_cast<jint>(widthMode),
      static_cast<jfloat>(height),
      static_cast<jint>(heightMode));
  if (!result) return false;
  auto *array = reinterpret_cast<jfloatArray>(result);
  if (env->GetArrayLength(array) < 2) {
    env->DeleteLocalRef(array);
    return false;
  }
  jfloat values[2] = {0.0f, 0.0f};
  env->GetFloatArrayRegion(array, 0, 2, values);
  env->DeleteLocalRef(array);
  *outWidth = values[0];
  *outHeight = values[1];
  return true;
}

void layoutRememberNodeType(RuntimeState *state, int nodeId, const std::string &type) {
  if (!state) return;
  state->nodeTypes[nodeId] = type;
#if ZYNTH_LAYOUT_ENGINE_YOGA
  if (state->yogaRuntime) {
    zynth_yoga_runtime_set_node_type(state->yogaRuntime, nodeId, type.c_str());
  }
#endif
}

void layoutMirrorSetText(RuntimeState *state, int nodeId, const std::string &text) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  axonMirrorSetText(state, nodeId, text);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  zynth_yoga_runtime_set_text(state->yogaRuntime, nodeId, text.c_str());
#endif
}

void layoutMirrorSetProp(RuntimeState *state, int nodeId, const std::string &name, const Value &value,
                         Runtime &rt) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  axonMirrorSetProp(state, nodeId, name, value, rt);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  auto propId = axonPropIdForName(name);
  if (!propId.has_value()) return;
  if (value.isNumber()) {
    const float raw = static_cast<float>(value.asNumber());
    const float scaled = axonScaleNumberValue(state, *propId, raw);
    zynth_yoga_runtime_set_style_number(state->yogaRuntime, nodeId, *propId, scaled);
    return;
  }
  if (value.isString()) {
    std::string text = value.asString(rt).utf8(rt);
    zynth_yoga_runtime_set_style_string(state->yogaRuntime, nodeId, *propId, text.c_str());
    return;
  }
  if (value.isBool()) {
    const char *text = value.getBool() ? "true" : "false";
    zynth_yoga_runtime_set_style_string(state->yogaRuntime, nodeId, *propId, text);
  }
#endif
}

void layoutMirrorInsertChild(RuntimeState *state, int parentId, int childId, int index) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  axonMirrorInsertChild(state, parentId, childId, index);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return;
  zynth_yoga_runtime_insert_child(
      state->yogaRuntime,
      axonResolveTreeNodeId(state, parentId),
      axonResolveTreeNodeId(state, childId),
      index);
#endif
}

void layoutMirrorRemoveChild(RuntimeState *state, int parentId, int childId) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  axonMirrorRemoveChild(state, parentId, childId);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return;
  zynth_yoga_runtime_remove_child(
      state->yogaRuntime,
      axonResolveTreeNodeId(state, parentId),
      axonResolveTreeNodeId(state, childId));
#endif
}

void layoutMirrorDropNode(RuntimeState *state, int nodeId) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  axonMirrorDropNode(state, nodeId);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state) return;
  nodeId = axonResolveTreeNodeId(state, nodeId);
  state->nodeTypes.erase(nodeId);
  if (state->yogaRuntime) {
    zynth_yoga_runtime_drop_node(state->yogaRuntime, nodeId);
  }
#endif
}

bool layoutComputeLayoutForRoot(RuntimeState *state, int rootId, float width, float height) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  return axonComputeLayoutForRoot(state, rootId, width, height);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return false;
  return zynth_yoga_runtime_compute_layout(
      state->yogaRuntime,
      axonResolveTreeNodeId(state, rootId),
      width,
      height);
#else
  return false;
#endif
}

bool layoutCollectFrames(RuntimeState *state, const int *nodeIds, std::size_t count, float *outFrames) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  if (!state || !state->axonEngine) return false;
  for (std::size_t i = 0; i < count; i++) {
    auto it = state->axonNodes.find(nodeIds[i]);
    if (it == state->axonNodes.end()) {
      continue;
    }
    AxonLayoutResult layout = axon_get_layout(state->axonEngine, it->second);
    const std::size_t base = i * 4;
    outFrames[base + 0] = layout.x;
    outFrames[base + 1] = layout.y;
    outFrames[base + 2] = layout.width;
    outFrames[base + 3] = layout.height;
  }
  return true;
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return false;
  return zynth_yoga_runtime_collect_frames(state->yogaRuntime, nodeIds, count, outFrames);
#else
  return false;
#endif
}

bool layoutSetStyleNumberForNode(RuntimeState *state, int nodeId, std::uint32_t propId, float value) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  return axonSetStyleNumberForNode(state, nodeId, propId, value);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return false;
  return zynth_yoga_runtime_set_style_number(
      state->yogaRuntime,
      axonResolveTreeNodeId(state, nodeId),
      propId,
      value);
#else
  return false;
#endif
}

bool layoutSetStyleStringForNode(RuntimeState *state, int nodeId, std::uint32_t propId, const std::string &value) {
#if ZYNTH_LAYOUT_ENGINE_AXON
  return axonSetStyleStringForNode(state, nodeId, propId, value);
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state || !state->yogaRuntime) return false;
  return zynth_yoga_runtime_set_style_string(
      state->yogaRuntime,
      axonResolveTreeNodeId(state, nodeId),
      propId,
      value.c_str());
#else
  return false;
#endif
}

void applyStyle(Runtime &rt, RuntimeState *state, JNIEnv *env, jint nodeId, const Object &style) {
  static const char *numericKeys[] = {
      "width", "height", "flex", "flexGrow", "flexShrink", "flexBasis",
      "padding", "paddingHorizontal", "paddingVertical", "paddingTop", "paddingRight",
      "paddingBottom", "paddingLeft", "margin", "marginHorizontal", "marginVertical",
      "marginTop", "marginRight", "marginBottom", "marginLeft", "borderRadius",
      "borderWidth", "fontSize", "top", "right", "bottom", "left", "opacity",
      "shadowOpacity", "shadowRadius", "elevation", "zIndex", "gap", "rowGap",
      "columnGap", "minWidth", "minHeight", "maxWidth", "maxHeight", "aspectRatio",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius",
      "borderBottomLeftRadius", "lineHeight", "lineSpacing", "paragraphSpacing",
      "letterSpacing", "baselineShift", "minimumFontScale"
  };

  static const char *stringKeys[] = {
      "flexDirection", "justifyContent", "alignItems", "alignSelf", "alignContent",
      "flexWrap", "background", "backgroundImage", "backgroundColor", "borderColor",
      "borderStyle", "fontWeight", "color", "position", "display", "overflow",
      "pointerEvents", "borderTopColor", "borderRightColor", "borderBottomColor",
      "borderLeftColor", "shadowColor", "boxShadow", "fontFamily", "fontStyle",
      "textAlign", "textDecorationLine", "textTransform", "hyphenation"
  };

  static const char *objectKeys[] = {
      "transform", "transformOrigin", "shadowOffset", "boxShadow",
      "background", "backgroundImage"
  };

  auto stringifyValue = [&rt](const Value &value) -> std::optional<std::string> {
    if (value.isString()) {
      return value.asString(rt).utf8(rt);
    }
    if (!value.isObject()) return std::nullopt;
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value result = stringify.call(rt, value);
      if (result.isString()) {
        return result.asString(rt).utf8(rt);
      }
    } catch (...) {
      return std::nullopt;
    }
    return std::nullopt;
  };

  for (const char *key : numericKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    if (v.isNumber()) {
      layoutMirrorSetProp(state, nodeId, key, v, rt);
      callSetProp(env, state, nodeId, key, std::to_string(v.asNumber()));
    } else if (v.isString()) {
      layoutMirrorSetProp(state, nodeId, key, v, rt);
      callSetProp(env, state, nodeId, key, v.asString(rt).utf8(rt));
    }
  }

  for (const char *key : stringKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    if (v.isString()) {
      layoutMirrorSetProp(state, nodeId, key, v, rt);
      callSetProp(env, state, nodeId, key, v.asString(rt).utf8(rt));
    }
  }

  for (const char *key : objectKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    auto value = stringifyValue(v);
    if (value) {
      callSetProp(env, state, nodeId, key, *value);
    }
  }
}

void applyProp(Runtime &rt, RuntimeState *state, JNIEnv *env, jint nodeId, const std::string &name,
               const Value &value) {
  if (name == "style" && value.isObject()) {
    applyStyle(rt, state, env, nodeId, value.asObject(rt));
    return;
  }
  layoutMirrorSetProp(state, nodeId, name, value, rt);
  if (value.isString()) {
    callSetProp(env, state, nodeId, name, value.asString(rt).utf8(rt));
    return;
  }
  if (value.isNumber()) {
    callSetProp(env, state, nodeId, name, std::to_string(value.asNumber()));
    return;
  }
  if (value.isBool()) {
    callSetProp(env, state, nodeId, name, value.getBool() ? "true" : "false");
  }
}

static std::string valueToString(Runtime &rt, const Value &value) {
  if (value.isString()) {
    return value.asString(rt).utf8(rt);
  }
  if (value.isNumber()) {
    // Remove trailing zeros/dot if integer-like
    std::string s = std::to_string(value.asNumber());
    s.erase(s.find_last_not_of('0') + 1, std::string::npos); 
    if(s.back() == '.') s.pop_back();
    return s;
  }
  if (value.isBool()) {
    return value.getBool() ? "true" : "false";
  }
  if (value.isNull()) {
    return "null";
  }
  if (value.isUndefined()) {
    return "undefined";
  }
  if (value.isObject()) {
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value result = stringify.call(rt, value);
      if (result.isString()) {
        return result.asString(rt).utf8(rt);
      }
    } catch (...) {
      // ignore
    }
    return "[object Object]";
  }
  return "";
}

std::string jsonEscape(const std::string &value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (unsigned char ch : value) {
    switch (ch) {
      case '\"':
        out += "\\\"";
        break;
      case '\\':
        out += "\\\\";
        break;
      case '\b':
        out += "\\b";
        break;
      case '\f':
        out += "\\f";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      case '\t':
        out += "\\t";
        break;
      default:
        if (ch < 0x20) {
          char buf[7];
          snprintf(buf, sizeof(buf), "\\u%04x", ch);
          out += buf;
        } else {
          out.push_back(static_cast<char>(ch));
        }
        break;
    }
  }
  return out;
}

void emitDevtoolsEvent(RuntimeState *state,
                       const std::string &topic,
                       const std::string &level,
                       const std::string &tag,
                       const std::string &data) {
  if (!state) return;
  JNIEnv *env = getEnv();
  if (!env) return;
  std::string payload = std::string("{\"topic\":\"") + jsonEscape(topic) +
                        "\",\"level\":\"" + jsonEscape(level) +
                        "\",\"tag\":\"" + jsonEscape(tag) +
                        "\",\"data\":\"" + jsonEscape(data) + "\"}";

  if (state->nativeOverlayClass && state->nativeOverlayHandleRaw) {
    jstring jPayload = env->NewStringUTF(payload.c_str());
    env->CallStaticVoidMethod(state->nativeOverlayClass, state->nativeOverlayHandleRaw, jPayload);
    env->DeleteLocalRef(jPayload);
  }

  if (state->devtoolsClass && state->devtoolsEmit) {
    jstring jPayload = env->NewStringUTF(payload.c_str());
    env->CallStaticVoidMethod(state->devtoolsClass, state->devtoolsEmit, jPayload);
    env->DeleteLocalRef(jPayload);
  }

  // Also forward devtools events into JS so in-app overlays can react without
  // relying on networked devtools.
  if (!state->runtime) return;
  try {
    Runtime &rt = *state->runtime;
    if (!rt.global().hasProperty(rt, "__zynth_onDevtoolsEventRaw")) return;
    Value handlerVal = rt.global().getProperty(rt, "__zynth_onDevtoolsEventRaw");
    if (!handlerVal.isObject()) return;
    Object handlerObj = handlerVal.asObject(rt);
    if (!handlerObj.isFunction(rt)) return;
    Function handlerFn = handlerObj.asFunction(rt);
    handlerFn.call(rt, String::createFromUtf8(rt, payload));
  } catch (...) {
    // Never allow diagnostics forwarding to crash the runtime.
    return;
  }
}

const char *signalName(int sig) {
  switch (sig) {
    case SIGSEGV:
      return "SIGSEGV";
    case SIGABRT:
      return "SIGABRT";
    case SIGBUS:
      return "SIGBUS";
    case SIGILL:
      return "SIGILL";
    case SIGFPE:
      return "SIGFPE";
    default:
      return "SIGNAL";
  }
}

void crashSignalHandler(int sig, siginfo_t *, void *) {
  if (gCrashPipe[1] != -1) {
    char buf[64];
    int len = snprintf(buf, sizeof(buf), "%s(%d)\n", signalName(sig), sig);
    if (len > 0) {
      write(gCrashPipe[1], buf, static_cast<size_t>(len));
    }
  }
  signal(sig, SIG_DFL);
  raise(sig);
}

void startCrashWatcherThread() {
  if (gCrashThreadStarted.exchange(true)) return;
  std::thread([]() {
    if (gVm == nullptr) return;
    JNIEnv *env = nullptr;
    if (gVm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return;
    char buf[128];
    while (true) {
      ssize_t readBytes = read(gCrashPipe[0], buf, sizeof(buf) - 1);
      if (readBytes <= 0) {
        break;
      }
      buf[readBytes] = '\0';
      if ((!gDevtoolsClass || !gDevtoolsEmitMethod) &&
          (!gNativeOverlayClass || !gNativeOverlayHandleRawMethod)) {
        continue;
      }
      std::string data(buf);
      std::string payload =
          std::string("{\"topic\":\"crash/native\",\"level\":\"error\",\"tag\":\"crash\",\"data\":\"") +
          jsonEscape(data) + "\"}";
      if (gDevtoolsClass && gDevtoolsEmitMethod) {
        jstring jPayload = env->NewStringUTF(payload.c_str());
        env->CallStaticVoidMethod(gDevtoolsClass, gDevtoolsEmitMethod, jPayload);
        env->DeleteLocalRef(jPayload);
      }
      if (gNativeOverlayClass && gNativeOverlayHandleRawMethod) {
        jstring jPayload = env->NewStringUTF(payload.c_str());
        env->CallStaticVoidMethod(gNativeOverlayClass, gNativeOverlayHandleRawMethod, jPayload);
        env->DeleteLocalRef(jPayload);
      }
    }
    gVm->DetachCurrentThread();
  }).detach();
}

void installCrashSignalHandlers() {
  if (gCrashHandlerInstalled.exchange(true)) return;
  if (pipe(gCrashPipe) != 0) {
    return;
  }
  startCrashWatcherThread();
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_sigaction = crashSignalHandler;
  sigemptyset(&action.sa_mask);
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigaction(SIGSEGV, &action, nullptr);
  sigaction(SIGABRT, &action, nullptr);
  sigaction(SIGBUS, &action, nullptr);
  sigaction(SIGILL, &action, nullptr);
  sigaction(SIGFPE, &action, nullptr);
}

void installConsole(Runtime &rt, RuntimeState *state) {
  auto logFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) message += " ";
          message += valueToString(rt, args[i]);
        }
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthJS", "%s", message.c_str());
        emitDevtoolsEvent(state, "log/console", "log", "console", message);
        return Value::undefined();
      });

  auto warnFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "warn"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) message += " ";
          message += valueToString(rt, args[i]);
        }
        __android_log_print(ANDROID_LOG_WARN, "ZynthJS", "%s", message.c_str());
        emitDevtoolsEvent(state, "log/console", "warn", "console", message);
        return Value::undefined();
      });

  auto errorFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "error"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        std::string message;
        for (size_t i = 0; i < count; i++) {
          if (i > 0) message += " ";
          message += valueToString(rt, args[i]);
        }
        __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "%s", message.c_str());
        emitDevtoolsEvent(state, "log/console", "error", "console", message);
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "info", logFn);
  console.setProperty(rt, "debug", logFn);
  console.setProperty(rt, "warn", warnFn);
  console.setProperty(rt, "error", errorFn);
  rt.global().setProperty(rt, "console", console);
  rt.global().setProperty(
      rt, "__ZYNTH_NATIVE_CONSOLE_DEVTOOLS__", Value(true));
}

void installModulesStub(Runtime &rt) {
  auto noop = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 0,
      [](Runtime &, const Value &, const Value *, size_t) -> Value {
        return Value::undefined();
      });
  Object modules(rt);
  modules.setProperty(rt, "call", noop);
  modules.setProperty(rt, "callSync", noop);
  rt.global().setProperty(rt, "__modules", modules);
  rt.global().setProperty(rt, "__zynthCallSync", noop);
}

void installGlobals(Runtime &rt) {
  Object globalThis = rt.global();
  globalThis.setProperty(rt, "global", globalThis);
  globalThis.setProperty(rt, "self", globalThis);
  globalThis.setProperty(rt, "window", globalThis);

  auto queueMicrotaskFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "queueMicrotask"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt)) {
          return Value::undefined();
        }
        Function fn = args[0].asObject(rt).asFunction(rt);
        try {
          rt.queueMicrotask(std::move(fn));
        } catch (...) {
          fn.call(rt);
        }
        return Value::undefined();
      });

  auto setImmediateFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setImmediate"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt)) {
          return Value::undefined();
        }
        Function fn = args[0].asObject(rt).asFunction(rt);
        try {
          rt.queueMicrotask(std::move(fn));
        } catch (...) {
          fn.call(rt);
        }
        return Value::undefined();
      });

  globalThis.setProperty(rt, "queueMicrotask", queueMicrotaskFn);
  globalThis.setProperty(rt, "setImmediate", setImmediateFn);
}

std::optional<std::string> stringifyDevtoolsPayload(Runtime &rt, const Value &value) {
  if (value.isString()) return value.asString(rt).utf8(rt);
  if (value.isNumber()) return std::to_string(value.asNumber());
  if (value.isBool()) return value.getBool() ? "true" : "false";
  if (value.isNull()) return "null";
  if (value.isUndefined()) return std::nullopt;
  if (value.isObject()) {
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value jsonStr = stringify.call(rt, value);
      if (jsonStr.isString()) {
        return jsonStr.asString(rt).utf8(rt);
      }
    } catch (...) {
      return std::nullopt;
    }
  }
  return std::nullopt;
}

void installDevtoolsBridge(Runtime &rt, RuntimeState *state) {
  if (!state) return;
  Object globalThis = rt.global();

  auto emitFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__zynth_devtools_emit"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || !state->devtoolsClass || !state->devtoolsEmit || count < 1) {
          __android_log_print(ANDROID_LOG_WARN, "ZynthDevtools", "emit skipped (no class/method or args)");
          return Value::undefined();
        }
        auto payload = stringifyDevtoolsPayload(rt, args[0]);
        if (!payload || payload->empty()) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jstring jPayload = env->NewStringUTF(payload->c_str());
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthDevtools", "emit payload=%s", payload->c_str());
        env->CallStaticVoidMethod(state->devtoolsClass, state->devtoolsEmit, jPayload);
        env->DeleteLocalRef(jPayload);
        return Value::undefined();
      });

  auto isConnectedFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__zynth_devtools_isConnected"), 0,
      [state](Runtime &, const Value &, const Value *, size_t) -> Value {
        if (!state || !state->devtoolsClass || !state->devtoolsIsConnected) {
          return Value(false);
        }
        JNIEnv *env = getEnv();
        if (!env) return Value(false);
        jboolean connected =
            env->CallStaticBooleanMethod(state->devtoolsClass, state->devtoolsIsConnected);
        return Value(static_cast<bool>(connected));
      });

  globalThis.setProperty(rt, "__zynth_devtools_emit", emitFn);
  globalThis.setProperty(rt, "__zynth_devtools_isConnected", isConnectedFn);
}

std::shared_ptr<RuntimeState> sharedStateFor(facebook::hermes::HermesRuntime *runtime) {
  std::lock_guard<std::mutex> lock(gStateMutex);
  auto it = gStates.find(runtime);
  if (it == gStates.end()) return nullptr;
  return it->second;
}

RuntimeState *stateFor(facebook::hermes::HermesRuntime *runtime) {
  auto shared = sharedStateFor(runtime);
  return shared ? shared.get() : nullptr;
}

static void installJSIPlugins(Runtime &rt, RuntimeState *state) {
  std::vector<ZynthJSIPluginInstaller> installers;
  {
    std::lock_guard<std::mutex> lock(gPluginMutex);
    installers = gPluginInstallers;
  }
  for (auto installer : installers) {
    if (!installer) continue;
    installer(rt, state);
  }
}

extern "C" JNIEXPORT void ZynthRegisterJSIPluginInstaller(ZynthJSIPluginInstaller installer) {
  if (!installer) return;
  std::lock_guard<std::mutex> lock(gPluginMutex);
  gPluginInstallers.push_back(installer);
}

extern "C" JNIEXPORT void ZynthRegisterSharedSignalChangedCallback(ZynthSharedSignalChangedCallback callback) {
  if (!callback) return;
  __android_log_print(ANDROID_LOG_DEBUG, "ZynthKit", "Registering shared signal callback: %p", callback);
  std::lock_guard<std::mutex> lock(gPluginMutex);
  gSharedSignalCallbacks.push_back(callback);
}

extern "C" JNIEXPORT int ZynthCreateSharedSignal(void *state, double initialValue) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return 0;
  int id = runtimeState->nextSharedSignalId.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(runtimeState->sharedSignalsMutex);
    runtimeState->sharedSignals[id] = initialValue;
  }
  return id;
}

extern "C" JNIEXPORT double ZynthGetSharedSignal(void *state, int signalId, bool *found) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) {
    if (found) *found = false;
    return std::numeric_limits<double>::quiet_NaN();
  }
  std::lock_guard<std::mutex> lock(runtimeState->sharedSignalsMutex);
  auto it = runtimeState->sharedSignals.find(signalId);
  if (it == runtimeState->sharedSignals.end()) {
    if (found) *found = false;
    return std::numeric_limits<double>::quiet_NaN();
  }
  if (found) *found = true;
  return it->second;
}

extern "C" JNIEXPORT bool ZynthSetSharedSignal(void *state, int signalId, double value) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return false;
  {
    std::lock_guard<std::mutex> lock(runtimeState->sharedSignalsMutex);
    auto it = runtimeState->sharedSignals.find(signalId);
    if (it == runtimeState->sharedSignals.end()) return false;
    it->second = value;
  }

  std::vector<ZynthSharedSignalChangedCallback> callbacks;
  {
    std::lock_guard<std::mutex> lock(gPluginMutex);
    callbacks = gSharedSignalCallbacks;
  }
  for (auto callback : callbacks) {
    callback(state, signalId);
  }

  return true;
}

extern "C" JNIEXPORT int ZynthCreateSyncSignal(void *state, const char *initialValue) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return 0;
  int id = runtimeState->nextSyncSignalId.fetch_add(1);
  {
    std::lock_guard<std::mutex> lock(runtimeState->syncSignalsMutex);
    runtimeState->syncSignals[id] = initialValue ? std::string(initialValue) : std::string();
  }
  return id;
}

extern "C" JNIEXPORT bool ZynthGetSyncSignal(
    void *state,
    int signalId,
    std::string &outValue) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return false;
  std::lock_guard<std::mutex> lock(runtimeState->syncSignalsMutex);
  auto it = runtimeState->syncSignals.find(signalId);
  if (it == runtimeState->syncSignals.end()) {
    return false;
  }
  outValue = it->second;
  return true;
}

extern "C" JNIEXPORT bool JNICALL
Java_com_zynth_kit_runtime_JSBridge_getSyncSignal(JNIEnv *env, jobject, jlong ptr, jint signalId, jobject value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return false;
  auto *state = stateFor(runtime);
  if (!state) return false;
  std::string str;
  if (!ZynthGetSyncSignal(state, signalId, str)) return false;
  
  jclass sbClass = env->GetObjectClass(value);
  jmethodID appendMethod = env->GetMethodID(sbClass, "append", "(Ljava/lang/String;)Ljava/lang/StringBuilder;");
  jstring jStr = env->NewStringUTF(str.c_str());
  env->CallObjectMethod(value, appendMethod, jStr);
  env->DeleteLocalRef(jStr);
  return true;
}

extern "C" JNIEXPORT bool ZynthSetSyncSignal(void *state, int signalId, const char *value) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState) return false;
  std::lock_guard<std::mutex> lock(runtimeState->syncSignalsMutex);
  auto it = runtimeState->syncSignals.find(signalId);
  if (it == runtimeState->syncSignals.end()) return false;
  it->second = value ? std::string(value) : std::string();
  return true;
}

extern "C" JNIEXPORT bool JNICALL
Java_com_zynth_kit_runtime_JSBridge_setSyncSignal(JNIEnv *env, jobject, jlong ptr, jint signalId, jstring value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return false;
  auto *state = stateFor(runtime);
  if (!state) return false;
  const char *chars = env->GetStringUTFChars(value, nullptr);
  bool result = ZynthSetSyncSignal(state, signalId, chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

extern "C" JNIEXPORT void ZynthApplyAnimatedStyle(
    void *state,
    int nodeId,
    float opacity,
    float translateX,
    float translateY,
    float scaleX,
    float scaleY,
    float rotate,
    float rotateX,
    float rotateY,
    float skewX,
    float skewY,
    float perspective) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState || !runtimeState->uiManager || !runtimeState->applyAnimatedStyle) {
    return;
  }
  JNIEnv *env = getEnv();
  if (!env) return;
  env->CallVoidMethod(
      runtimeState->uiManager,
      runtimeState->applyAnimatedStyle,
      nodeId,
      opacity,
      translateX,
      translateY,
      scaleX,
      scaleY,
      rotate,
      rotateX,
      rotateY,
      skewX,
      skewY,
      perspective);
}

extern "C" JNIEXPORT void ZynthApplyAnimatedLayoutStyle(
    void *state,
    int nodeId,
    float width,
    float height,
    float minWidth,
    float minHeight,
    float maxWidth,
    float maxHeight,
    float flexBasis) {
  auto *runtimeState = reinterpret_cast<RuntimeState *>(state);
  if (!runtimeState || !runtimeState->uiManager || !runtimeState->applyAnimatedLayoutStyle) {
    return;
  }
  JNIEnv *env = getEnv();
  if (!env) return;
  env->CallVoidMethod(
      runtimeState->uiManager,
      runtimeState->applyAnimatedLayoutStyle,
      nodeId,
      width,
      height,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      flexBasis);
}

void installTimers(Runtime &rt, facebook::hermes::HermesRuntime *runtime) {
  auto hostSetTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetTimeout"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isObject()) return Value::undefined();
        Object fnObject = args[0].asObject(rt);
        if (!fnObject.isFunction(rt)) return Value::undefined();

        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        int delayMs = (count > 1 && args[1].isNumber())
                          ? static_cast<int>(args[1].asNumber())
                          : 0;
        
        std::vector<Value> callArgs;
        if (count > 2 && args[2].isObject()) {
          Object maybeArray = args[2].asObject(rt);
          if (maybeArray.isArray(rt)) {
            Array array = maybeArray.asArray(rt);
            size_t length = array.size(rt);
            callArgs.reserve(length);
            for (size_t i = 0; i < length; i++) {
              callArgs.emplace_back(Value(rt, array.getValueAtIndex(rt, i)));
            }
          }
        }

        int timerId = state->timerContext->nextTimerId.fetch_add(1);
        {
          std::lock_guard<std::mutex> lock(state->timerContext->mutex);
          state->timerContext->timers[timerId] = {
              std::make_shared<Function>(fnObject.asFunction(rt)),
              std::move(callArgs),
              false
          };
        }

        env->CallVoidMethod(state->uiManager, state->scheduleTimer,
                            reinterpret_cast<jlong>(runtime), timerId, delayMs, false);
        return Value(static_cast<double>(timerId));
      });

  auto hostSetInterval = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostSetInterval"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isObject()) return Value::undefined();
        Object fnObject = args[0].asObject(rt);
        if (!fnObject.isFunction(rt)) return Value::undefined();

        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        int delayMs = (count > 1 && args[1].isNumber())
                          ? static_cast<int>(args[1].asNumber())
                          : 0;
        if (delayMs < 1) delayMs = 1;

        std::vector<Value> callArgs;
        if (count > 2 && args[2].isObject()) {
          Object maybeArray = args[2].asObject(rt);
          if (maybeArray.isArray(rt)) {
            Array array = maybeArray.asArray(rt);
            size_t length = array.size(rt);
            callArgs.reserve(length);
            for (size_t i = 0; i < length; i++) {
              callArgs.emplace_back(Value(rt, array.getValueAtIndex(rt, i)));
            }
          }
        }

        int timerId = state->timerContext->nextTimerId.fetch_add(1);
        {
          std::lock_guard<std::mutex> lock(state->timerContext->mutex);
          state->timerContext->timers[timerId] = {
              std::make_shared<Function>(fnObject.asFunction(rt)),
              std::move(callArgs),
              true
          };
        }

        env->CallVoidMethod(state->uiManager, state->scheduleTimer,
                            reinterpret_cast<jlong>(runtime), timerId, delayMs, true);
        return Value(static_cast<double>(timerId));
      });

  auto hostClearTimeout = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "__hostClearTimeout"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        
        int timerId = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->timerContext->mutex);
          state->timerContext->timers.erase(timerId);
        }
        
                env->CallVoidMethod(state->uiManager, state->cancelTimer, timerId);
                return Value::undefined();
              });
        
          auto hostClearInterval = Function::createFromHostFunction(
              rt, PropNameID::forAscii(rt, "__hostClearInterval"), 1,
              [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
                if (count < 1 || !args[0].isNumber()) return Value::undefined();
                RuntimeState *state = stateFor(runtime);
                if (!state) return Value::undefined();
                JNIEnv *env = getEnv();
                if (!env) return Value::undefined();
                
                int timerId = static_cast<int>(args[0].asNumber());
                {
                  std::lock_guard<std::mutex> lock(state->timerContext->mutex);
                  state->timerContext->timers.erase(timerId);
                }
                
                env->CallVoidMethod(state->uiManager, state->cancelTimer, timerId);
                return Value::undefined();
              });
        
          auto hostRequestAnimationFrame = Function::createFromHostFunction(
              rt, PropNameID::forAscii(rt, "__hostRequestAnimationFrame"), 1,
              [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
                if (count < 1 || !args[0].isObject()) return Value::undefined();
                Object fnObject = args[0].asObject(rt);
                if (!fnObject.isFunction(rt)) return Value::undefined();
        
                RuntimeState *state = stateFor(runtime);
                if (!state) return Value::undefined();
                JNIEnv *env = getEnv();
                if (!env) return Value::undefined();
        
                int timerId = state->timerContext->nextTimerId.fetch_add(1);
                {
                  std::lock_guard<std::mutex> lock(state->timerContext->mutex);
                  state->timerContext->timers[timerId] = {
                      std::make_shared<Function>(fnObject.asFunction(rt)),
                      {}, 
                      false
                  };
                }
        
                env->CallVoidMethod(state->uiManager, state->scheduleAnimationFrame,
                                    reinterpret_cast<jlong>(runtime), timerId);
                return Value(static_cast<double>(timerId));
              });
        
          auto hostCancelAnimationFrame = Function::createFromHostFunction(
              rt, PropNameID::forAscii(rt, "__hostCancelAnimationFrame"), 1,
              [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
                if (count < 1 || !args[0].isNumber()) return Value::undefined();
                RuntimeState *state = stateFor(runtime);
                if (!state) return Value::undefined();
                JNIEnv *env = getEnv();
                if (!env) return Value::undefined();
                
                int timerId = static_cast<int>(args[0].asNumber());
                {
                  std::lock_guard<std::mutex> lock(state->timerContext->mutex);
                  state->timerContext->timers.erase(timerId);
                }
                
                env->CallVoidMethod(state->uiManager, state->cancelAnimationFrame, timerId);
                return Value::undefined();
              });
        
          rt.global().setProperty(rt, "__hostSetTimeout", hostSetTimeout);
          rt.global().setProperty(rt, "__hostSetInterval", hostSetInterval);
          rt.global().setProperty(rt, "__hostClearTimeout", hostClearTimeout);
          rt.global().setProperty(rt, "__hostClearInterval", hostClearInterval);
          rt.global().setProperty(rt, "__hostRequestAnimationFrame", hostRequestAnimationFrame);
          rt.global().setProperty(rt, "__hostCancelAnimationFrame", hostCancelAnimationFrame);
        
          static const char *timerScript =
              "globalThis.setTimeout=(fn,ms,...a)=>__hostSetTimeout(fn,ms|0,a);"
              "globalThis.clearTimeout=(id)=>__hostClearTimeout(id);"
              "globalThis.setInterval=(fn,ms,...a)=>__hostSetInterval(fn,ms|0,a);"
              "globalThis.clearInterval=(id)=>__hostClearInterval(id);"
              "globalThis.setImmediate=(fn,...a)=>__hostSetTimeout(fn,0,a);"
              "globalThis.clearImmediate=(id)=>__hostClearTimeout(id);"
              "globalThis.requestAnimationFrame=(fn)=>__hostRequestAnimationFrame(fn);"
              "globalThis.cancelAnimationFrame=(id)=>__hostCancelAnimationFrame(id);";
        
          auto buffer = std::make_shared<StringBuffer>(timerScript);
          runtime->evaluateJavaScript(buffer, "timers.js");
        }
        
        static const char *kZynthSharedValueKey = "__zynth_shared_value";
        
void installSharedSignals(Runtime &rt, RuntimeState *state) {  if (!state) return;
  auto createSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        double initial = args[0].asNumber();
        int id = ZynthCreateSharedSignal(state, initial);
        if (id <= 0) return Value::undefined();
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets",
                            "createSharedSignal id=%d value=%.3f", id, initial);
        return Value(static_cast<double>(id));
      });

  auto getSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        bool found = false;
        double value = ZynthGetSharedSignal(state, id, &found);
        if (!found) return Value::undefined();
        return Value(value);
      });

  auto setSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSharedSignal"), 2,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        double value = args[1].asNumber();
        if (!ZynthSetSharedSignal(state, id, value)) return Value::undefined();
        return Value::undefined();
      });

  auto removeSharedSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeSharedSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
          state->sharedSignals.erase(id);
        }
        return Value::undefined();
      });

  Object shared(rt);
  shared.setProperty(rt, "createSharedSignal", createSharedSignal);
  shared.setProperty(rt, "getSharedSignal", getSharedSignal);
  shared.setProperty(rt, "setSharedSignal", setSharedSignal);
  shared.setProperty(rt, "removeSharedSignal", removeSharedSignal);
  rt.global().setProperty(rt, "__zynth_shared_signals", shared);
}

void installSyncSignals(Runtime &rt, RuntimeState *state) {
  if (!state) return;

  auto createSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createSyncSignal"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) return Value::undefined();
        std::string initial = args[0].asString(rt).utf8(rt);
        int id = ZynthCreateSyncSignal(state, initial.c_str());
        if (id <= 0) return Value::undefined();
        return Value(static_cast<double>(id));
      });

  auto getSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "getSyncSignal"), 1,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        std::string value;
        if (!ZynthGetSyncSignal(state, id, value)) return Value::undefined();
        return Value(String::createFromUtf8(rt, value));
      });

  auto setSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSyncSignal"), 2,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        int id = static_cast<int>(args[0].asNumber());
        std::string value = args[1].asString(rt).utf8(rt);
        if (!ZynthSetSyncSignal(state, id, value.c_str())) return Value::undefined();
        return Value::undefined();
      });

  auto removeSyncSignal = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeSyncSignal"), 1,
      [state](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        int id = static_cast<int>(args[0].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->syncSignalsMutex);
          state->syncSignals.erase(id);
        }
        return Value::undefined();
      });

  Object sync(rt);
  sync.setProperty(rt, "createSyncSignal", createSyncSignal);
  sync.setProperty(rt, "getSyncSignal", getSyncSignal);
  sync.setProperty(rt, "setSyncSignal", setSyncSignal);
  sync.setProperty(rt, "removeSyncSignal", removeSyncSignal);
  rt.global().setProperty(rt, "__zynth_sync_signals", sync);

  auto bindSyncSignalNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "bindSyncSignalNode"), 2,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        int signalId = static_cast<int>(args[0].asNumber());
        int nodeId = static_cast<int>(args[1].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->syncSignalBindingsMutex);
          state->syncSignalBindings[nodeId] = signalId;
        }
        JNIEnv *env = getEnv();
        if (env && state->uiManager && state->setProp) {
          jstring jName = env->NewStringUTF("syncSignalId");
          jstring jValue = env->NewStringUTF(std::to_string(signalId).c_str());
          env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
          env->DeleteLocalRef(jName);
          env->DeleteLocalRef(jValue);
        }
        return Value::undefined();
      });

  auto unbindSyncSignalNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "unbindSyncSignalNode"), 2,
      [state](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        int nodeId = static_cast<int>(args[1].asNumber());
        {
          std::lock_guard<std::mutex> lock(state->syncSignalBindingsMutex);
          state->syncSignalBindings.erase(nodeId);
        }
        JNIEnv *env = getEnv();
        if (env && state->uiManager && state->setProp) {
          jstring jName = env->NewStringUTF("syncSignalId");
          jstring jValue = env->NewStringUTF("0");
          env->CallVoidMethod(state->uiManager, state->setProp, nodeId, jName, jValue);
          env->DeleteLocalRef(jName);
          env->DeleteLocalRef(jValue);
        }
        return Value::undefined();
      });

  rt.global().setProperty(rt, "__zynth_bindSyncSignalNode", bindSyncSignalNode);
  rt.global().setProperty(rt, "__zynth_unbindSyncSignalNode", unbindSyncSignalNode);
}

void ensureUIRuntime(const std::shared_ptr<RuntimeState> &state) {
  if (!state) return;
  if (state->uiRuntime) return;
  state->uiRuntime = facebook::hermes::makeHermesRuntime();
  installConsole(*state->uiRuntime, state.get());
  installGlobals(*state->uiRuntime);
  installSharedSignals(*state->uiRuntime, state.get());
  installSyncSignals(*state->uiRuntime, state.get());
  zynth::kit::installUICommandsRegistry(state, *state->uiRuntime);
  __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets", "UI runtime created");
}

void registerWorkletOnUIRuntime(const std::shared_ptr<RuntimeState> &state, int workletId) {
  if (!state) return;
  ensureUIRuntime(state);
  if (!state->uiRuntime) return;
  ZynthWorkletDefinition definition;
  {
    std::lock_guard<std::mutex> lock(state->workletMutex);
    auto it = state->pendingWorklets.find(workletId);
    if (it == state->pendingWorklets.end()) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets", "register missing id=%d", workletId);
      return;
    }
    definition = std::move(it->second);
    state->pendingWorklets.erase(it);
  }
  auto &rt = *state->uiRuntime;
  try {
    std::string source = definition.code;
    source.append("\n//# sourceURL=zynth-worklet.js");
    auto buffer = std::make_shared<StringBuffer>(source);
    auto result = rt.evaluateJavaScript(buffer, "zynth-worklet.js");
    if (!result.isObject() || !result.getObject(rt).isFunction(rt)) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets",
                          "register id=%d failed (evaluated result is NOT a function)", workletId);
      return;
    }
    auto fn = std::make_shared<Function>(result.getObject(rt).getFunction(rt));
    {
      std::lock_guard<std::mutex> lock(state->workletMutex);
      state->uiWorklets[workletId] = fn;
      state->uiWorkletClosures[workletId] = std::move(definition.closure);
    }
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets",
                        "registered id=%d location=%s", workletId, definition.location.c_str());
  } catch (const std::exception &ex) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                        "register exception id=%d %s", workletId, ex.what());
  }
}

void runWorkletOnUIRuntime(const std::shared_ptr<RuntimeState> &state, int workletId) {
  if (!state) return;
  ensureUIRuntime(state);
  if (!state->uiRuntime) return;
  std::shared_ptr<Function> fn;
  std::vector<ZynthWorkletClosureValue> closure;
  {
    std::lock_guard<std::mutex> lock(state->workletMutex);
    auto it = state->uiWorklets.find(workletId);
    if (it == state->uiWorklets.end()) {
      __android_log_print(ANDROID_LOG_WARN, "ZynthWorklets", "run missing id=%d", workletId);
      return;
    }
    fn = it->second;
    auto closureIt = state->uiWorkletClosures.find(workletId);
    if (closureIt != state->uiWorkletClosures.end()) {
      closure = closureIt->second;
    }
  }
  auto &rt = *state->uiRuntime;
  Object global = rt.global();
  for (const auto &entry : closure) {
    auto propId = PropNameID::forUtf8(rt, entry.name);
    switch (entry.kind) {
      case ZynthWorkletClosureValue::Kind::Shared: {
        int sharedId = entry.sharedId;
        auto getter = Function::createFromHostFunction(
            rt, propId, 0,
            [state, sharedId](Runtime &, const Value &, const Value *, size_t) -> Value {
              std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
              auto it = state->sharedSignals.find(sharedId);
              if (it == state->sharedSignals.end()) return Value::undefined();
              return Value(it->second);
            });
        global.setProperty(rt, propId, std::move(getter));
        break;
      }
      case ZynthWorkletClosureValue::Kind::Number:
        global.setProperty(rt, propId, Value(entry.numberValue));
        break;
      case ZynthWorkletClosureValue::Kind::Bool:
        global.setProperty(rt, propId, Value(entry.boolValue));
        break;
      case ZynthWorkletClosureValue::Kind::String:
        global.setProperty(rt, propId, String::createFromUtf8(rt, entry.stringValue));
        break;
    }
  }
  try {
    __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets", "run execute id=%d", workletId);
    fn->call(rt);
  } catch (const std::exception &ex) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                        "run exception id=%d %s", workletId, ex.what());
  }
}

std::optional<std::string> runInputHandlerWorkletOnUIRuntime(
    const std::shared_ptr<RuntimeState> &state,
    int workletId,
    const std::string &currentText,
    const std::string &newInput,
    const std::string &proposedText) {
  if (!state) return std::nullopt;
  ensureUIRuntime(state);
  if (!state->uiRuntime) return std::nullopt;
  std::shared_ptr<Function> fn;
  std::vector<ZynthWorkletClosureValue> closure;
  {
    std::lock_guard<std::mutex> lock(state->workletMutex);
    auto it = state->uiWorklets.find(workletId);
    if (it == state->uiWorklets.end()) {
      return std::nullopt;
    }
    fn = it->second;
    auto closureIt = state->uiWorkletClosures.find(workletId);
    if (closureIt != state->uiWorkletClosures.end()) {
      closure = closureIt->second;
    }
  }

  auto &rt = *state->uiRuntime;
  Object global = rt.global();
  for (const auto &entry : closure) {
    auto propId = PropNameID::forUtf8(rt, entry.name);
    switch (entry.kind) {
      case ZynthWorkletClosureValue::Kind::Shared: {
        int sharedId = entry.sharedId;
        auto getter = Function::createFromHostFunction(
            rt, propId, 0,
            [state, sharedId](Runtime &, const Value &, const Value *, size_t) -> Value {
              std::lock_guard<std::mutex> lock(state->sharedSignalsMutex);
              auto it = state->sharedSignals.find(sharedId);
              if (it == state->sharedSignals.end()) return Value::undefined();
              return Value(it->second);
            });
        global.setProperty(rt, propId, std::move(getter));
        break;
      }
      case ZynthWorkletClosureValue::Kind::Number:
        global.setProperty(rt, propId, Value(entry.numberValue));
        break;
      case ZynthWorkletClosureValue::Kind::Bool:
        global.setProperty(rt, propId, Value(entry.boolValue));
        break;
      case ZynthWorkletClosureValue::Kind::String:
        global.setProperty(rt, propId, String::createFromUtf8(rt, entry.stringValue));
        break;
    }
  }

  try {
    Value result = fn->call(
        rt, {
        Value(rt, String::createFromUtf8(rt, currentText)),
        Value(rt, String::createFromUtf8(rt, newInput)),
        Value(rt, String::createFromUtf8(rt, proposedText))
        });
    if (result.isString()) {
      return result.asString(rt).utf8(rt);
    }
  } catch (const std::exception &ex) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                       "run exception id=%d %s", workletId, ex.what());
  } catch (...) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthWorklets",
                       "run unknown exception id=%d", workletId);
  }
  return std::nullopt;
}

void installWorkletsBridge(Runtime &rt, facebook::hermes::HermesRuntime *runtime) {
  auto state = sharedStateFor(runtime);
  if (!state) return;
  auto registerWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "register"), 1,
      [state, runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 1 || !args[0].isObject()) return Value::undefined();
        Object payload = args[0].asObject(rt);
        if (!payload.hasProperty(rt, "code")) return Value::undefined();
        Value codeVal = payload.getProperty(rt, "code");
        if (!codeVal.isString()) return Value::undefined();
        ZynthWorkletDefinition definition;
        definition.code = codeVal.asString(rt).utf8(rt);
        if (payload.hasProperty(rt, "location")) {
          Value locVal = payload.getProperty(rt, "location");
          if (locVal.isString()) {
            definition.location = locVal.asString(rt).utf8(rt);
          }
        }
        if (payload.hasProperty(rt, "closure")) {
          Value closureVal = payload.getProperty(rt, "closure");
          if (closureVal.isObject()) {
            Object closureObj = closureVal.asObject(rt);
            Array keys = closureObj.getPropertyNames(rt);
            size_t keyCount = keys.size(rt);
            for (size_t i = 0; i < keyCount; i++) {
              Value keyVal = keys.getValueAtIndex(rt, i);
              if (!keyVal.isString()) continue;
              std::string name = keyVal.asString(rt).utf8(rt);
              Value entryVal = closureObj.getProperty(rt, name.c_str());
              if (entryVal.isObject()) {
                Object entryObj = entryVal.asObject(rt);
                if (entryObj.hasProperty(rt, kZynthSharedValueKey)) {
                  Value idVal = entryObj.getProperty(rt, kZynthSharedValueKey);
                  if (idVal.isNumber()) {
                    ZynthWorkletClosureValue entry;
                    entry.name = name;
                    entry.kind = ZynthWorkletClosureValue::Kind::Shared;
                    entry.sharedId = static_cast<int>(idVal.asNumber());
                    definition.closure.push_back(entry);
                  }
                }
                continue;
              }
              if (entryVal.isNumber()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::Number;
                entry.numberValue = entryVal.asNumber();
                definition.closure.push_back(entry);
              } else if (entryVal.isBool()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::Bool;
                entry.boolValue = entryVal.getBool();
                definition.closure.push_back(entry);
              } else if (entryVal.isString()) {
                ZynthWorkletClosureValue entry;
                entry.name = name;
                entry.kind = ZynthWorkletClosureValue::Kind::String;
                entry.stringValue = entryVal.asString(rt).utf8(rt);
                definition.closure.push_back(entry);
              }
            }
          }
        }
        int workletId = state->nextWorkletId.fetch_add(1);
        {
          std::lock_guard<std::mutex> lock(state->workletMutex);
          state->pendingWorklets[workletId] = std::move(definition);
        }
        JNIEnv *env = getEnv();
        if (env && state->jsBridgeClass && state->postRegisterWorklet) {
          env->CallStaticVoidMethod(state->jsBridgeClass, state->postRegisterWorklet,
                                    reinterpret_cast<jlong>(runtime), static_cast<jint>(workletId));
        }
        __android_log_print(ANDROID_LOG_DEBUG, "ZynthWorklets", "register id=%d", workletId);
        return Value(static_cast<double>(workletId));
      });

  auto runWorklet = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "run"), 1,
      [state, runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 1 || !args[0].isNumber()) return Value::undefined();
        int workletId = static_cast<int>(args[0].asNumber());
        JNIEnv *env = getEnv();
        if (env && state->jsBridgeClass && state->postRunWorklet) {
          env->CallStaticVoidMethod(state->jsBridgeClass, state->postRunWorklet,
                                    reinterpret_cast<jlong>(runtime), static_cast<jint>(workletId),
                                    static_cast<jlong>(0));
        }
        return Value::undefined();
      });

  auto runAfter = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "runAfter"), 2,
      [state, runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (!state || count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int workletId = static_cast<int>(args[0].asNumber());
        long delayMs = static_cast<long>(args[1].asNumber());
        JNIEnv *env = getEnv();
        if (env && state->jsBridgeClass && state->postRunWorklet) {
          env->CallStaticVoidMethod(state->jsBridgeClass, state->postRunWorklet,
                                    reinterpret_cast<jlong>(runtime), static_cast<jint>(workletId),
                                    static_cast<jlong>(delayMs));
        }
        return Value::undefined();
      });

  Object worklets(rt);
  worklets.setProperty(rt, "register", registerWorklet);
  worklets.setProperty(rt, "run", runWorklet);
  worklets.setProperty(rt, "runAfter", runAfter);
  rt.global().setProperty(rt, "__zynth_worklets", worklets);
}

void installUIBindings(Runtime &rt, facebook::hermes::HermesRuntime *runtime) {
  auto createNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createNode"), 1,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        std::string type = args[0].asString(rt).utf8(rt);
        jstring jType = env->NewStringUTF(type.c_str());
        jint nodeId = env->CallIntMethod(state->uiManager, state->createNode, jType);
        env->DeleteLocalRef(jType);
        if (nodeId > 0) {
          layoutRememberNodeType(state, static_cast<int>(nodeId), type);
          axonEnsureNode(state, static_cast<int>(nodeId));
        }
        return Value(static_cast<double>(nodeId));
      });

  auto setProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isString()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string name = args[1].asString(rt).utf8(rt);
        applyProp(rt, state, env, nodeId, name, args[2]);
        return Value::undefined();
      });

  auto setText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string text = args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
        layoutMirrorSetText(state, static_cast<int>(nodeId), text);
        jstring jText = env->NewStringUTF(text.c_str());
        env->CallVoidMethod(state->uiManager, state->setText, nodeId, jText);
        env->DeleteLocalRef(jText);
        return Value::undefined();
      });

  auto syncInputState = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "syncInputState"), 5,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 5 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state || !state->syncTextInputState) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string newText = args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
        std::string nativeText = args[2].isString() ? args[2].asString(rt).utf8(rt) : "";

        // ==========================================
        // 1) THE NO-OP DIFF CHECK
        // ==========================================
        if (newText == nativeText) {
            // The pipeline text matches the native OS buffer exactly (e.g., autocorrect).
            // We short-circuit and DO NOT overwrite the native view, protecting the OS cursor state.
            return Value(true); 
        }

        // ==========================================
        // 2) SELECTION SYNC WRITE-BACK
        // ==========================================
        jint selStart = static_cast<jint>(args[3].isNumber() ? args[3].asNumber() : -1);
        jint selEnd = static_cast<jint>(args[4].isNumber() ? args[4].asNumber() : -1);

        jstring jNewText = env->NewStringUTF(newText.c_str());
        
        env->CallVoidMethod(
            state->uiManager, 
            state->syncTextInputState, 
            nodeId, 
            jNewText, 
            selStart, 
            selEnd
        );

        env->DeleteLocalRef(jNewText);
        return Value(true);
      });

  auto insertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isNumber() || !args[2].isNumber()) {
          return Value::undefined();
        }
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        layoutMirrorInsertChild(
            state,
            static_cast<int>(args[0].asNumber()),
            static_cast<int>(args[1].asNumber()),
            static_cast<int>(args[2].asNumber()));
        env->CallVoidMethod(state->uiManager, state->insertChild,
                            static_cast<jint>(args[0].asNumber()),
                            static_cast<jint>(args[1].asNumber()),
                            static_cast<jint>(args[2].asNumber()));
        return Value::undefined();
      });

  auto removeChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) return Value::undefined();
        removeHandlersForNode(runtime, static_cast<int>(args[1].asNumber()));
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        layoutMirrorRemoveChild(
            state,
            static_cast<int>(args[0].asNumber()),
            static_cast<int>(args[1].asNumber()));
        env->CallVoidMethod(state->uiManager, state->removeChild,
                            static_cast<jint>(args[0].asNumber()),
                            static_cast<jint>(args[1].asNumber()));
        return Value::undefined();
      });

  auto setHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        jint nodeId = static_cast<jint>(args[0].asNumber());
        std::string name = args[1].asString(rt).utf8(rt);
        jstring jName = env->NewStringUTF(name.c_str());
        if (count >= 3 && args[2].isObject() && args[2].asObject(rt).isFunction(rt)) {
          Object fnObj = args[2].asObject(rt);
          if (
              name == "handler" &&
              fnObj.hasProperty(rt, "__zynth_worklet_id") &&
              fnObj.getProperty(rt, "__zynth_worklet_id").isNumber() &&
              state->setInputHandler) {
            jint workletId =
                static_cast<jint>(fnObj.getProperty(rt, "__zynth_worklet_id").asNumber());
            env->CallVoidMethod(state->uiManager, state->setInputHandler, nodeId, workletId);
            env->DeleteLocalRef(jName);
            return Value::undefined();
          }
          Function fn = fnObj.asFunction(rt);
          std::lock_guard<std::mutex> lock(gHandlerMutex);
          gHandlers[HandlerKey{runtime, nodeId, name}] = HandlerEntry{
              runtime, std::make_shared<Function>(std::move(fn))};
        }
        env->CallVoidMethod(state->uiManager, state->setHandler, nodeId, jName);
        env->DeleteLocalRef(jName);
        return Value::undefined();
      });

  auto clearInputHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "clearInputHandler"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state || !state->clearInputHandler) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(
            state->uiManager,
            state->clearInputHandler,
            static_cast<jint>(args[0].asNumber()));
        return Value::undefined();
      });

  auto applyBatch = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatch"), 1,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        std::string json = args[0].isString() ? args[0].asString(rt).utf8(rt) : "";
        jstring jJson = env->NewStringUTF(json.c_str());
        env->CallVoidMethod(state->uiManager, state->applyBatch, jJson);
        env->DeleteLocalRef(jJson);
        return Value::undefined();
      });

  auto applyBatchTyped = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatchTyped"), 1,
      [runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        Object payload = args[0].asObject(rt);
        auto isTruthy = [&rt](const Value &value) -> bool {
          if (value.isBool()) {
            return value.getBool();
          }
          if (value.isNumber()) {
            return value.asNumber() != 0.0;
          }
          if (value.isString()) {
            std::string text = value.asString(rt).utf8(rt);
            std::transform(text.begin(), text.end(), text.begin(),
                           [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
            return text == "true" || text == "1" || text == "yes" || text == "on";
          }
          return false;
        };
        auto isAtomicKind = [](const std::string &kind) -> bool {
          return kind == "transition" || kind == "navigation" || kind == "theme";
        };
        auto shouldUseAtomicCommit = [&]() -> bool {
          Value metaVal = payload.getProperty(rt, "meta");
          if (!metaVal.isObject()) return false;
          Object metaObject = metaVal.asObject(rt);
          Value extrasVal = metaObject.getProperty(rt, "extras");
          if (extrasVal.isObject()) {
            Object extrasObject = extrasVal.asObject(rt);
            if (isTruthy(extrasObject.getProperty(rt, "atomic"))) return true;
            if (isTruthy(extrasObject.getProperty(rt, "syncFrame"))) return true;
          }
          Value kindVal = metaObject.getProperty(rt, "kind");
          if (kindVal.isString() && isAtomicKind(kindVal.asString(rt).utf8(rt))) return true;
          Value scopeVal = metaObject.getProperty(rt, "scope");
          if (scopeVal.isString() && isAtomicKind(scopeVal.asString(rt).utf8(rt))) return true;
          return false;
        };
        auto recordBatchMetrics = [&]() {
          if (!state->noteAxonMetricsBatch) return;
          Value metaVal = payload.getProperty(rt, "meta");
          if (!metaVal.isObject()) return;
          Object metaObject = metaVal.asObject(rt);
          int surfaceId = state->activeSurfaceId;
          Value targetVal = metaObject.getProperty(rt, "target");
          if (targetVal.isNumber()) {
            surfaceId = static_cast<int>(targetVal.asNumber());
          }
          std::string kind;
          Value kindVal = metaObject.getProperty(rt, "kind");
          if (kindVal.isString()) {
            kind = kindVal.asString(rt).utf8(rt);
          } else {
            Value scopeVal = metaObject.getProperty(rt, "scope");
            if (scopeVal.isString()) {
              kind = scopeVal.asString(rt).utf8(rt);
            }
          }
          jstring jKind = env->NewStringUTF(kind.c_str());
          env->CallVoidMethod(state->uiManager, state->noteAxonMetricsBatch, static_cast<jint>(surfaceId), jKind);
          env->DeleteLocalRef(jKind);
        };
        recordBatchMetrics();
        struct AtomicCommitScope {
          JNIEnv *env = nullptr;
          RuntimeState *state = nullptr;
          bool active = false;
          AtomicCommitScope(JNIEnv *jniEnv, RuntimeState *runtimeState, bool enabled)
              : env(jniEnv), state(runtimeState) {
            if (!enabled || !env || !state || !state->beginAtomicCommit || !state->endAtomicCommit) {
              return;
            }
            env->CallVoidMethod(state->uiManager, state->beginAtomicCommit);
            active = true;
          }
          ~AtomicCommitScope() {
            if (!active || !env || !state || !state->endAtomicCommit) return;
            env->CallVoidMethod(state->uiManager, state->endAtomicCommit);
          }
        };
        AtomicCommitScope atomicCommitScope(env, state, shouldUseAtomicCommit());
        auto mirrorPackedOps = [&](const double *opsData, size_t opCount, const Array &stringTable) {
          if (!opsData || !state) return;
          size_t i = 0;
          while (i < opCount) {
            int opcode = static_cast<int>(opsData[i++]);
            switch (opcode) {
              case 1: {
                if (i + 3 >= opCount) return;
                int nodeId = static_cast<int>(opsData[i++]);
                int keyToken = static_cast<int>(opsData[i++]);
                int valueType = static_cast<int>(opsData[i++]);
                double payloadValue = opsData[i++];
                if (keyToken >= 0) {
                  continue;
                }
                std::uint32_t propId = static_cast<std::uint32_t>(-keyToken);
                if (valueType == 1) {
                  const float raw = static_cast<float>(payloadValue);
                  const float scaled = axonScaleNumberValue(state, propId, raw);
                  layoutSetStyleNumberForNode(state, nodeId, propId, scaled);
                } else if (valueType == 2) {
                  Value entry = stringTable.getValueAtIndex(rt, static_cast<size_t>(payloadValue));
                  if (entry.isString()) {
                    std::string value = entry.asString(rt).utf8(rt);
                    layoutSetStyleStringForNode(state, nodeId, propId, value);
                  }
                }
                break;
              }
              case 2: {
                if (i + 1 >= opCount) return;
                int nodeId = static_cast<int>(opsData[i++]);
                int textIndex = static_cast<int>(opsData[i++]);
                Value entry = stringTable.getValueAtIndex(rt, static_cast<size_t>(textIndex));
                std::string text = entry.isString() ? entry.asString(rt).utf8(rt) : "";
                layoutMirrorSetText(state, nodeId, text);
                break;
              }
              case 3: {
                if (i + 2 >= opCount) return;
                int parentId = static_cast<int>(opsData[i++]);
                int childId = static_cast<int>(opsData[i++]);
                int index = static_cast<int>(opsData[i++]);
                layoutMirrorInsertChild(state, parentId, childId, index);
                break;
              }
              case 4: {
                if (i + 1 >= opCount) return;
                int parentId = static_cast<int>(opsData[i++]);
                int childId = static_cast<int>(opsData[i++]);
                layoutMirrorRemoveChild(state, parentId, childId);
                break;
              }
              case 5: {
                if (i >= opCount) return;
                layoutMirrorDropNode(state, static_cast<int>(opsData[i++]));
                break;
              }
              default:
                return;
            }
          }
        };
        Value opsPackedVal = payload.getProperty(rt, "ops");
        Value stringTableVal = payload.getProperty(rt, "stringTable");
        if (opsPackedVal.isObject() && stringTableVal.isObject()) {
          Object opsObject = opsPackedVal.asObject(rt);
          Object stringTableObject = stringTableVal.asObject(rt);
          if (!stringTableObject.isArray(rt)) return Value::undefined();
          Array stringTable = stringTableObject.asArray(rt);
          const size_t stringCount = stringTable.length(rt);
          jdoubleArray jOps = nullptr;
          if (opsObject.isArrayBuffer(rt)) {
            ArrayBuffer buffer = opsObject.getArrayBuffer(rt);
            const size_t byteLength = buffer.size(rt);
            const size_t opCount = byteLength / sizeof(double);
            std::vector<double> mirrorOps(opCount);
            if (opCount > 0) {
              std::memcpy(mirrorOps.data(), buffer.data(rt), opCount * sizeof(double));
            }
            mirrorPackedOps(mirrorOps.data(), opCount, stringTable);
            if (state->applyBatchTypedBuffer) {
              jobject jBuffer = env->NewDirectByteBuffer(buffer.data(rt), static_cast<jlong>(byteLength));
              if (!jBuffer) return Value::undefined();

              jclass stringClass = state->stringClass;
              if (!stringClass) {
                jclass localStringClass = env->FindClass("java/lang/String");
                if (!localStringClass) {
                  env->DeleteLocalRef(jBuffer);
                  return Value::undefined();
                }
                stringClass = localStringClass;
                state->stringClass = static_cast<jclass>(env->NewGlobalRef(localStringClass));
                env->DeleteLocalRef(localStringClass);
              }
              jobjectArray jStrings = env->NewObjectArray(static_cast<jsize>(stringCount), stringClass, nullptr);
              for (size_t i = 0; i < stringCount; i++) {
                Value entry = stringTable.getValueAtIndex(rt, i);
                if (entry.isString()) {
                  std::string utf8 = entry.asString(rt).utf8(rt);
                  jstring jStr = env->NewStringUTF(utf8.c_str());
                  env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jStr);
                  env->DeleteLocalRef(jStr);
                }
              }

              env->CallVoidMethod(state->uiManager, state->applyBatchTypedBuffer, jBuffer,
                                  static_cast<jint>(opCount), jStrings);
              env->DeleteLocalRef(jBuffer);
              env->DeleteLocalRef(jStrings);
              return Value::undefined();
            }

            if (!state->applyBatchTypedPacked) return Value::undefined();
            jOps = env->NewDoubleArray(static_cast<jsize>(opCount));
            if (!jOps) return Value::undefined();
            if (opCount > 0) {
              const auto *data = reinterpret_cast<const uint8_t *>(buffer.data(rt));
              std::vector<jdouble> opsBuffer(opCount);
              std::memcpy(opsBuffer.data(), data, opCount * sizeof(double));
              env->SetDoubleArrayRegion(jOps, 0, static_cast<jsize>(opCount), opsBuffer.data());
            }
          } else if (opsObject.isArray(rt)) {
            if (!state->applyBatchTypedPacked) return Value::undefined();
            Array opsPacked = opsObject.asArray(rt);
            const size_t opCount = opsPacked.length(rt);
            jOps = env->NewDoubleArray(static_cast<jsize>(opCount));
            if (!jOps) return Value::undefined();
            std::vector<jdouble> opsBuffer(opCount);
            for (size_t i = 0; i < opCount; i++) {
              Value opVal = opsPacked.getValueAtIndex(rt, i);
              opsBuffer[i] = opVal.isNumber() ? opVal.asNumber() : 0.0;
            }
            mirrorPackedOps(opsBuffer.data(), opCount, stringTable);
            env->SetDoubleArrayRegion(jOps, 0, static_cast<jsize>(opCount), opsBuffer.data());
          } else {
            return Value::undefined();
          }

          jclass stringClass = state->stringClass;
          if (!stringClass) {
            jclass localStringClass = env->FindClass("java/lang/String");
            if (!localStringClass) {
              env->DeleteLocalRef(jOps);
              return Value::undefined();
            }
            stringClass = localStringClass;
            state->stringClass = static_cast<jclass>(env->NewGlobalRef(localStringClass));
            env->DeleteLocalRef(localStringClass);
          }
          jobjectArray jStrings = env->NewObjectArray(static_cast<jsize>(stringCount), stringClass, nullptr);
          for (size_t i = 0; i < stringCount; i++) {
            Value entry = stringTable.getValueAtIndex(rt, i);
            if (entry.isString()) {
              std::string utf8 = entry.asString(rt).utf8(rt);
              jstring jStr = env->NewStringUTF(utf8.c_str());
              env->SetObjectArrayElement(jStrings, static_cast<jsize>(i), jStr);
              env->DeleteLocalRef(jStr);
            }
          }

          env->CallVoidMethod(state->uiManager, state->applyBatchTypedPacked, jOps, jStrings);
          env->DeleteLocalRef(jOps);
          env->DeleteLocalRef(jStrings);
          return Value::undefined();
        }
        Value opsVal = payload.getProperty(rt, "operations");
        if (!opsVal.isObject()) return Value::undefined();
        Array ops = opsVal.asObject(rt).asArray(rt);
        const size_t opCount = ops.length(rt);
        for (size_t i = 0; i < opCount; i++) {
          Value opVal = ops.getValueAtIndex(rt, i);
          if (!opVal.isObject()) continue;
          Object op = opVal.asObject(rt);
          Value typeVal = op.getProperty(rt, "type");
          if (!typeVal.isString()) continue;
          std::string type = typeVal.asString(rt).utf8(rt);
          if (type == "createNode") {
            Value tagVal = op.getProperty(rt, "tag");
            if (tagVal.isString()) {
              __android_log_print(ANDROID_LOG_WARN, "ZynthUI",
                                  "applyBatchTyped createNode op is unsupported on Android");
            }
            continue;
          }
          if (type == "setProp") {
            Value idVal = op.getProperty(rt, "nodeId");
            Value nameVal = op.getProperty(rt, "name");
            Value valueVal = op.getProperty(rt, "value");
            if (!idVal.isNumber() || !nameVal.isString()) continue;
            applyProp(rt, state, env, static_cast<jint>(idVal.asNumber()),
                      nameVal.asString(rt).utf8(rt), valueVal);
            continue;
          }
          if (type == "setText") {
            Value idVal = op.getProperty(rt, "nodeId");
            Value valueVal = op.getProperty(rt, "value");
            if (!idVal.isNumber()) continue;
            std::string text;
            if (valueVal.isString()) {
              text = valueVal.asString(rt).utf8(rt);
            } else if (valueVal.isNumber()) {
              text = std::to_string(valueVal.asNumber());
            }
            layoutMirrorSetText(state, static_cast<int>(idVal.asNumber()), text);
            jstring jText = env->NewStringUTF(text.c_str());
            env->CallVoidMethod(state->uiManager, state->setText, static_cast<jint>(idVal.asNumber()), jText);
            env->DeleteLocalRef(jText);
            continue;
          }
          if (type == "insertChild") {
            Value parentVal = op.getProperty(rt, "parentId");
            Value childVal = op.getProperty(rt, "childId");
            Value indexVal = op.getProperty(rt, "index");
            if (!parentVal.isNumber() || !childVal.isNumber() || !indexVal.isNumber()) continue;
            layoutMirrorInsertChild(
                state,
                static_cast<int>(parentVal.asNumber()),
                static_cast<int>(childVal.asNumber()),
                static_cast<int>(indexVal.asNumber()));
            env->CallVoidMethod(state->uiManager, state->insertChild,
                                static_cast<jint>(parentVal.asNumber()),
                                static_cast<jint>(childVal.asNumber()),
                                static_cast<jint>(indexVal.asNumber()));
            continue;
          }
          if (type == "removeChild") {
            Value parentVal = op.getProperty(rt, "parentId");
            Value childVal = op.getProperty(rt, "childId");
            if (!parentVal.isNumber() || !childVal.isNumber()) continue;
            removeHandlersForNode(runtime, static_cast<int>(childVal.asNumber()));
            layoutMirrorRemoveChild(
                state,
                static_cast<int>(parentVal.asNumber()),
                static_cast<int>(childVal.asNumber()));
            env->CallVoidMethod(state->uiManager, state->removeChild,
                                static_cast<jint>(parentVal.asNumber()),
                                static_cast<jint>(childVal.asNumber()));
            continue;
          }
        }
        return Value::undefined();
      });

  auto setSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSurface"), 1,
      [runtime](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value::undefined();
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        const jint surfaceId = static_cast<jint>(args[0].asNumber());
        state->activeSurfaceId = static_cast<int>(surfaceId);
        axonEnsureNode(state, state->activeSurfaceId);
        layoutRememberNodeType(state, state->activeSurfaceId, "root");
        layoutSetStyleStringForNode(state, state->activeSurfaceId, 33, "column");
#if ZYNTH_LAYOUT_ENGINE_YOGA
        if (state->yogaRuntime) {
          zynth_yoga_runtime_set_surface_root(state->yogaRuntime, state->activeSurfaceId);
        }
#endif
        env->CallVoidMethod(state->uiManager, state->setSurface, surfaceId);
        return Value::undefined();
      });

  auto flush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [runtime](Runtime &, const Value &, const Value *, size_t) -> Value {
        RuntimeState *state = stateFor(runtime);
        if (!state) return Value::undefined();
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();
        env->CallVoidMethod(state->uiManager, state->flush);
        return Value::undefined();
      });

  Object ui(rt);
  ui.setProperty(rt, "createNode", createNode);
  ui.setProperty(rt, "setProp", setProp);
  ui.setProperty(rt, "setText", setText);
  ui.setProperty(rt, "syncInputState", syncInputState);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "clearInputHandler", clearInputHandler);
  ui.setProperty(rt, "applyBatch", applyBatch);
  ui.setProperty(rt, "applyBatchTyped", applyBatchTyped);
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "flush", flush);
  ui.setProperty(rt, "__supportsTypedProps", true);
  ui.setProperty(rt, "__supportsTypedBatch", true);
  rt.global().setProperty(rt, "__ui", ui);
}

} // namespace

namespace zynth::kit {

void uiCommandSetProp(
    const UICommandsState &state,
    int nodeId,
    const std::string &name,
    const std::string &value) {
  if (!state) return;
  auto resolved = std::static_pointer_cast<RuntimeState>(state);
  if (!resolved) return;
  JNIEnv *env = getEnv();
  if (!env) return;
  jstring jName = env->NewStringUTF(name.c_str());
  jstring jValue = env->NewStringUTF(value.c_str());
  env->CallVoidMethod(resolved->uiManager, resolved->setProp, static_cast<jint>(nodeId), jName, jValue);
  env->DeleteLocalRef(jName);
  env->DeleteLocalRef(jValue);
}

} // namespace zynth::kit

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeAnimationFrame(JNIEnv *,
                                                jobject,
                                                jlong ptr,
                                                jint callbackId,
                                                jdouble timestampMs) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  
  std::shared_ptr<Function> callback;

  {
    std::shared_ptr<TimerContext> ctx;
    {
      std::lock_guard<std::mutex> lock(gStateMutex);
      auto it = gStates.find(runtime);
      if (it != gStates.end() && it->second) {
        ctx = it->second->timerContext;
      }
    }
    
    if (ctx) {
      std::lock_guard<std::mutex> lock(ctx->mutex);
      auto &timers = ctx->timers;
      auto tit = timers.find(callbackId);
      if (tit != timers.end()) {
        callback = tit->second.callback;
        timers.erase(tit); // RAF is one-shot
      }
    }
  }

  if (callback) {
    Runtime &rt = *runtime;
    Value arg(timestampMs);
    try {
      callback->call(rt, arg);
    } catch (const JSError &error) {
       __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "RAF error: %s", error.getMessage().c_str());
       auto state = sharedStateFor(runtime);
       std::string message = error.getMessage();
       std::string stack = error.getStack();
       std::string combined = stack.empty() ? message : (message + "\n" + stack);
       emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
    } catch (...) {
       __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "RAF exception");
    }
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_setSharedSignal(JNIEnv *, jobject, jlong ptr, jint id, jdouble value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;
  ZynthSetSharedSignal(state.get(), id, value);
}

extern "C" JNIEXPORT jdouble JNICALL
Java_com_zynth_kit_runtime_JSBridge_getSharedSignal(JNIEnv *, jobject, jlong ptr, jint id) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return std::numeric_limits<jdouble>::quiet_NaN();
  auto state = sharedStateFor(runtime);
  if (!state) return std::numeric_limits<jdouble>::quiet_NaN();
  bool found = false;
  double value = ZynthGetSharedSignal(state.get(), id, &found);
  if (!found) return std::numeric_limits<jdouble>::quiet_NaN();
  return value;
}

extern "C" jint JNI_OnLoad(JavaVM *vm, void *) {
  gVm = vm;
  return facebook::jni::initialize(vm, [] {});
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_zynth_kit_runtime_JSBridge_createHermesRuntime(JNIEnv *, jobject) {
  auto runtime = facebook::hermes::makeHermesRuntime();
  return reinterpret_cast<jlong>(runtime.release());
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_destroyHermesRuntime(JNIEnv *, jobject, jlong ptr) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;

  // Cleanup handlers associated with this runtime to avoid crash in ~Function
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    for (auto it = gHandlers.begin(); it != gHandlers.end();) {
      if (it->second.runtime == runtime) {
        it = gHandlers.erase(it);
      } else {
        ++it;
      }
    }
  }

  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    auto it = gStates.find(runtime);
    if (it != gStates.end()) {
      JNIEnv *env = getEnv();
      if (env && it->second) {
        if (it->second->axonEngine) {
          axon_engine_free(it->second->axonEngine);
          it->second->axonEngine = nullptr;
        }
        #if ZYNTH_LAYOUT_ENGINE_YOGA
        if (it->second->yogaRuntime) {
          zynth_yoga_runtime_destroy(it->second->yogaRuntime);
          it->second->yogaRuntime = nullptr;
        }
        #endif
        if (it->second->uiManager) env->DeleteGlobalRef(it->second->uiManager);
        if (it->second->uiClass) env->DeleteGlobalRef(it->second->uiClass);
        if (it->second->jsBridgeClass) env->DeleteGlobalRef(it->second->jsBridgeClass);
        if (it->second->devtoolsClass) env->DeleteGlobalRef(it->second->devtoolsClass);
        if (it->second->nativeOverlayClass) env->DeleteGlobalRef(it->second->nativeOverlayClass);
      }
      gStates.erase(it);
    }
  }
  delete runtime;
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_installUIBindings(JNIEnv *env, jobject, jlong ptr, jobject uiManager) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !uiManager) return;

  auto state = std::make_shared<RuntimeState>();
  state->runtime = runtime;
  state->uiManager = env->NewGlobalRef(uiManager);
  state->uiClass = static_cast<jclass>(env->NewGlobalRef(env->GetObjectClass(uiManager)));
  state->activeSurfaceId = 0;
#if ZYNTH_LAYOUT_ENGINE_AXON
  state->axonEngine = axon_engine_new();
  if (state->axonEngine) {
    state->axonNodes[0] = axon_node_create(state->axonEngine, nullptr);
    axon_text_set_measure_callback(state->axonEngine, axonMeasureTextWithJava, state.get());
    axon_node_set_measurement_callback(state->axonEngine, axonMeasureNodeWithJava, state.get());
  }
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  state->yogaRuntime = zynth_yoga_runtime_create(state.get(), yogaMeasureTextWithJava, yogaMeasureNodeWithJava);
#endif
  state->createNode = env->GetMethodID(state->uiClass, "createNode", "(Ljava/lang/String;)I");
  state->setProp = env->GetMethodID(state->uiClass, "setProp", "(ILjava/lang/String;Ljava/lang/String;)V");
  state->setText = env->GetMethodID(state->uiClass, "setText", "(ILjava/lang/String;)V");
  state->syncTextInputState = env->GetMethodID(state->uiClass, "syncTextInputState", "(ILjava/lang/String;II)V");
  state->insertChild = env->GetMethodID(state->uiClass, "insertChild", "(III)V");
  state->removeChild = env->GetMethodID(state->uiClass, "removeChild", "(II)V");
  state->setHandler = env->GetMethodID(state->uiClass, "setHandler", "(ILjava/lang/String;)V");
  state->setInputHandler = env->GetMethodID(state->uiClass, "setInputHandler", "(II)V");
  state->clearInputHandler = env->GetMethodID(state->uiClass, "clearInputHandler", "(I)V");
  state->applyBatch = env->GetMethodID(state->uiClass, "applyBatch", "(Ljava/lang/String;)V");
  state->applyBatchTypedPacked =
      env->GetMethodID(state->uiClass, "applyBatchTypedPacked", "([D[Ljava/lang/String;)V");
  state->applyBatchTypedBuffer =
      env->GetMethodID(state->uiClass, "applyBatchTypedBuffer", "(Ljava/nio/ByteBuffer;I[Ljava/lang/String;)V");
  state->beginAtomicCommit = env->GetMethodID(state->uiClass, "beginAtomicCommit", "()V");
  state->endAtomicCommit = env->GetMethodID(state->uiClass, "endAtomicCommit", "()V");
  state->setSurface = env->GetMethodID(state->uiClass, "setSurface", "(I)V");
  state->flush = env->GetMethodID(state->uiClass, "flush", "()V");
  state->applyAnimatedStyle =
      env->GetMethodID(state->uiClass, "applyAnimatedStyle", "(IFFFFFFFFFFF)V");
  state->applyAnimatedLayoutStyle =
      env->GetMethodID(state->uiClass, "applyAnimatedLayoutStyle", "(IFFFFFFF)V");
  state->axonRegisterResolvedFont =
      env->GetMethodID(state->uiClass, "axonRegisterResolvedFont", "(Ljava/lang/String;IZF)I");
  state->axonMeasureText =
      env->GetMethodID(state->uiClass, "axonMeasureText", "(ILjava/lang/String;Z)[F");
  state->axonMeasureNode =
      env->GetMethodID(state->uiClass, "axonMeasureNode", "(IFIFI)[F");
  state->yogaMeasureTextNode =
      env->GetMethodID(state->uiClass, "yogaMeasureTextNode", "(IFIFI)[F");
  state->axonDensity = env->GetMethodID(state->uiClass, "axonDensity", "()F");
  state->noteAxonMetricsBatch =
      env->GetMethodID(state->uiClass, "noteAxonMetricsBatch", "(ILjava/lang/String;)V");
  if (state->axonDensity) {
    state->density = env->CallFloatMethod(state->uiManager, state->axonDensity);
  }
  state->scheduleTimer = env->GetMethodID(state->uiClass, "scheduleTimer", "(JIIZ)V");
  state->cancelTimer = env->GetMethodID(state->uiClass, "cancelTimer", "(I)V");
  state->scheduleAnimationFrame = env->GetMethodID(state->uiClass, "scheduleAnimationFrame", "(JI)V");
  state->cancelAnimationFrame = env->GetMethodID(state->uiClass, "cancelAnimationFrame", "(I)V");
  jclass bridgeClass = env->FindClass("com/zynth/kit/runtime/JSBridge");
  if (bridgeClass) {
    state->jsBridgeClass = static_cast<jclass>(env->NewGlobalRef(bridgeClass));
    env->DeleteLocalRef(bridgeClass);
    state->postRegisterWorklet = env->GetStaticMethodID(state->jsBridgeClass, "postRegisterWorklet", "(JI)V");
    state->postRunWorklet = env->GetStaticMethodID(state->jsBridgeClass, "postRunWorklet", "(JIJ)V");
  }
  jclass devtoolsClass = env->FindClass("com/zynth/kit/runtime/modules/DevtoolsModule");
  if (devtoolsClass) {
    state->devtoolsClass = static_cast<jclass>(env->NewGlobalRef(devtoolsClass));
    env->DeleteLocalRef(devtoolsClass);
    state->devtoolsEmit = env->GetStaticMethodID(state->devtoolsClass, "emitNativeEvent", "(Ljava/lang/String;)V");
    state->devtoolsIsConnected = env->GetStaticMethodID(state->devtoolsClass, "isConnected", "()Z");
    if (!gDevtoolsClass) {
      gDevtoolsClass = static_cast<jclass>(env->NewGlobalRef(state->devtoolsClass));
      gDevtoolsEmitMethod = state->devtoolsEmit;
    }
  }
  jclass nativeOverlayClass = env->FindClass("com/zynth/kit/runtime/ZynthNativeErrorOverlay");
  if (nativeOverlayClass) {
    state->nativeOverlayClass = static_cast<jclass>(env->NewGlobalRef(nativeOverlayClass));
    env->DeleteLocalRef(nativeOverlayClass);
    state->nativeOverlayHandleRaw =
        env->GetStaticMethodID(state->nativeOverlayClass, "handleRawEvent", "(Ljava/lang/String;)V");
    if (!gNativeOverlayClass && state->nativeOverlayClass && state->nativeOverlayHandleRaw) {
      gNativeOverlayClass = static_cast<jclass>(env->NewGlobalRef(state->nativeOverlayClass));
      gNativeOverlayHandleRawMethod = state->nativeOverlayHandleRaw;
    }
  }
  jclass stringCls = env->FindClass("java/lang/String");
  if (stringCls) {
    state->stringClass = static_cast<jclass>(env->NewGlobalRef(stringCls));
    env->DeleteLocalRef(stringCls);
  }

  {
    std::lock_guard<std::mutex> lock(gStateMutex);
    gStates[runtime] = state;
  }

  installConsole(*runtime, state.get());
  installGlobals(*runtime);
  installDevtoolsBridge(*runtime, state.get());
  installCrashSignalHandlers();
  installModulesStub(*runtime);
  installTimers(*runtime, runtime);
  installUIBindings(*runtime, runtime);
  installSharedSignals(*runtime, state.get());
  installSyncSignals(*runtime, state.get());
  installWorkletsBridge(*runtime, runtime);
  auto shared = sharedStateFor(runtime);
  if (shared) {
    zynth::kit::installUICommandsRegistry(shared, *runtime);
  }
  runtime->global().setProperty(
      *runtime, "__ZYNTH_PLATFORM", String::createFromUtf8(*runtime, "android"));
  installJSIPlugins(*runtime, state.get());
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonComputeLayout(
    JNIEnv *,
    jobject,
    jlong ptr,
    jint rootId,
    jfloat width,
    jfloat height) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
  if (!state) return JNI_FALSE;
  return layoutComputeLayoutForRoot(state, static_cast<int>(rootId), width, height) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jlongArray JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonGetLastComputeStats(
    JNIEnv *env,
    jobject,
    jlong ptr) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return nullptr;
  RuntimeState *state = stateFor(runtime);
  if (!state || !state->axonEngine) return nullptr;
  AxonComputeStats stats{};
  if (!axon_get_last_compute_stats(state->axonEngine, &stats)) {
    return nullptr;
  }
  jlong values[] = {
      static_cast<jlong>(stats.total_time_ns),
      static_cast<jlong>(stats.node_count),
      static_cast<jlong>(stats.layout_node_calls),
      static_cast<jlong>(stats.layout_cache_hits),
      static_cast<jlong>(stats.layout_cache_misses),
      static_cast<jlong>(stats.min_content_cache_hits),
      static_cast<jlong>(stats.min_content_cache_misses),
      static_cast<jlong>(stats.intrinsic_measure_calls),
      static_cast<jlong>(stats.intrinsic_text_calls),
      static_cast<jlong>(stats.intrinsic_host_calls),
      static_cast<jlong>(stats.prepare_calls),
      static_cast<jlong>(stats.prepare_cache_hits),
      static_cast<jlong>(stats.prepare_cache_misses),
      static_cast<jlong>(stats.prepare_time_ns),
      static_cast<jlong>(stats.layout_calls),
      static_cast<jlong>(stats.layout_time_ns),
      static_cast<jlong>(stats.min_content_calls),
      static_cast<jlong>(stats.min_content_time_ns),
      static_cast<jlong>(stats.setup_cache_hits),
      static_cast<jlong>(stats.setup_cache_misses),
      static_cast<jlong>(stats.segment_cache_hits),
      static_cast<jlong>(stats.segment_cache_misses),
      static_cast<jlong>(stats.host_measure_calls),
      static_cast<jlong>(stats.host_measure_time_ns),
      static_cast<jlong>(stats.prepared_segments),
      static_cast<jlong>(stats.prepared_bytes),
      static_cast<jlong>(stats.top_layout_node_ids[0]),
      static_cast<jlong>(stats.top_layout_node_counts[0]),
      static_cast<jlong>(stats.top_layout_constraint_unique_counts[0]),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][0].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][0].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][0].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][0].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][0].flags),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][1].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][1].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][1].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][1].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][1].flags),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][2].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][2].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][2].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][2].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[0][2].flags),
      static_cast<jlong>(stats.top_layout_node_ids[1]),
      static_cast<jlong>(stats.top_layout_node_counts[1]),
      static_cast<jlong>(stats.top_layout_constraint_unique_counts[1]),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][0].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][0].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][0].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][0].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][0].flags),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][1].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][1].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][1].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][1].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][1].flags),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][2].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][2].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][2].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][2].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[1][2].flags),
      static_cast<jlong>(stats.top_layout_node_ids[2]),
      static_cast<jlong>(stats.top_layout_node_counts[2]),
      static_cast<jlong>(stats.top_layout_constraint_unique_counts[2]),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][0].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][0].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][0].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][0].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][0].flags),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][1].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][1].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][1].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][1].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][1].flags),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][2].available_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][2].available_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][2].known_width_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][2].known_height_bits),
      static_cast<jlong>(stats.top_layout_constraint_samples[2][2].flags),
      static_cast<jlong>(stats.top_min_content_node_ids[0]),
      static_cast<jlong>(stats.top_min_content_node_counts[0]),
      static_cast<jlong>(stats.top_min_content_node_ids[1]),
      static_cast<jlong>(stats.top_min_content_node_counts[1]),
      static_cast<jlong>(stats.top_min_content_node_ids[2]),
      static_cast<jlong>(stats.top_min_content_node_counts[2]),
  };
  jlongArray array = env->NewLongArray(static_cast<jsize>(sizeof(values) / sizeof(values[0])));
  if (!array) return nullptr;
  env->SetLongArrayRegion(array, 0, static_cast<jsize>(sizeof(values) / sizeof(values[0])), values);
  return array;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonCollectFrames(
    JNIEnv *env,
    jobject,
    jlong ptr,
    jintArray nodeIds,
    jfloatArray outFrames) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !nodeIds || !outFrames) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
  if (!state) return JNI_FALSE;

  const jsize count = env->GetArrayLength(nodeIds);
  if (env->GetArrayLength(outFrames) < count * 4) return JNI_FALSE;

  std::vector<jint> ids(static_cast<size_t>(count));
  std::vector<jfloat> frames(static_cast<size_t>(count) * 4, 0.0f);
  env->GetIntArrayRegion(nodeIds, 0, count, ids.data());

  if (!layoutCollectFrames(state, ids.data(), static_cast<size_t>(count), frames.data())) {
    return JNI_FALSE;
  }
  env->SetFloatArrayRegion(outFrames, 0, count * 4, frames.data());
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonSetStyleNumber(
    JNIEnv *,
    jobject,
    jlong ptr,
    jint nodeId,
    jint propId,
    jfloat value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
  if (!state) return JNI_FALSE;
  return layoutSetStyleNumberForNode(
             state,
             static_cast<int>(nodeId),
             static_cast<std::uint32_t>(propId),
             value)
         ? JNI_TRUE
         : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonSetStyleString(
    JNIEnv *env,
    jobject,
    jlong ptr,
    jint nodeId,
    jint propId,
    jstring value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !value) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
  if (!state) return JNI_FALSE;
  const char *chars = env->GetStringUTFChars(value, nullptr);
  if (!chars) return JNI_FALSE;
  std::string text(chars);
  env->ReleaseStringUTFChars(value, chars);
  return layoutSetStyleStringForNode(
             state,
             static_cast<int>(nodeId),
             static_cast<std::uint32_t>(propId),
             text)
         ? JNI_TRUE
         : JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonRegisterResolvedFont(
    JNIEnv *env,
    jobject,
    jlong ptr,
    jstring family,
    jint weight,
    jboolean italic,
    jfloat sizePx) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !family) return static_cast<jint>(UINT32_MAX);
  RuntimeState *state = stateFor(runtime);
#if ZYNTH_LAYOUT_ENGINE_AXON
  if (!state || !state->axonEngine) return static_cast<jint>(UINT32_MAX);
  const char *chars = env->GetStringUTFChars(family, nullptr);
  if (!chars) return static_cast<jint>(UINT32_MAX);
  std::uint32_t fontId = axon_font_register_resolved(
      state->axonEngine,
      chars,
      static_cast<std::uint16_t>(weight),
      italic == JNI_TRUE,
      sizePx);
  const float clampedSizePx = sizePx > 0.0f ? sizePx : 16.0f;
  state->axonFallbackFonts[fontId] = RuntimeState::AxonFallbackFontMetrics{
      clampedSizePx,
      std::max(clampedSizePx * 1.3f, 1.0f),
      std::max(clampedSizePx * 0.55f, 1.0f),
  };
  env->ReleaseStringUTFChars(family, chars);
  return static_cast<jint>(fontId);
#else
  return 0;
#endif
}

extern "C" JNIEXPORT jint JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonPrewarmResolvedFont(
    JNIEnv *env,
    jobject,
    jlong ptr,
    jstring family,
    jint weight,
    jboolean italic,
    jfloat sizePx) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !family) return static_cast<jint>(UINT32_MAX);
  RuntimeState *state = stateFor(runtime);
#if ZYNTH_LAYOUT_ENGINE_AXON
  if (!state || !state->axonEngine) return static_cast<jint>(UINT32_MAX);
  const char *chars = env->GetStringUTFChars(family, nullptr);
  if (!chars) return static_cast<jint>(UINT32_MAX);
  std::uint32_t fontId = axon_font_prewarm_resolved(
      state->axonEngine,
      chars,
      static_cast<std::uint16_t>(weight),
      italic == JNI_TRUE,
      sizePx);
  const float clampedSizePx = sizePx > 0.0f ? sizePx : 16.0f;
  state->axonFallbackFonts[fontId] = RuntimeState::AxonFallbackFontMetrics{
      clampedSizePx,
      std::max(clampedSizePx * 1.3f, 1.0f),
      std::max(clampedSizePx * 0.55f, 1.0f),
  };
  env->ReleaseStringUTFChars(family, chars);
  return static_cast<jint>(fontId);
#else
  return 0;
#endif
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonSetTextMeasureMode(
    JNIEnv *,
    jobject,
    jlong ptr,
    jint mode) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
  if (!state) return JNI_FALSE;
#if ZYNTH_LAYOUT_ENGINE_AXON
  state->axonTextMeasureMode =
      mode == 1 ? RuntimeState::AxonTextMeasureMode::Fallback
                : RuntimeState::AxonTextMeasureMode::Java;
#else
  mode = mode;
#endif
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonInvalidateFontCache(
    JNIEnv *,
    jobject,
    jlong ptr,
    jint fontId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
#if ZYNTH_LAYOUT_ENGINE_AXON
  if (!state || !state->axonEngine) return JNI_FALSE;
  bool ok = axon_font_invalidate_cache(
      state->axonEngine,
      static_cast<std::uint32_t>(fontId));
  return ok ? JNI_TRUE : JNI_FALSE;
#else
  fontId = fontId;
  return JNI_TRUE;
#endif
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonSetTextMeasure(
    JNIEnv *env,
    jobject,
    jlong ptr,
    jint nodeId,
    jstring text,
    jint fontId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !text) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
#if ZYNTH_LAYOUT_ENGINE_AXON
  if (!state || !state->axonEngine) return JNI_FALSE;
  std::size_t nativeId = axonEnsureNode(state, static_cast<int>(nodeId));
  if (nativeId == std::numeric_limits<std::size_t>::max()) return JNI_FALSE;
  const char *chars = env->GetStringUTFChars(text, nullptr);
  if (!chars) return JNI_FALSE;
  bool ok = axon_node_set_measure_text(
      state->axonEngine,
      nativeId,
      chars,
      static_cast<std::size_t>(fontId));
  env->ReleaseStringUTFChars(text, chars);
  return ok ? JNI_TRUE : JNI_FALSE;
#else
  if (!state) return JNI_FALSE;
  const char *chars = env->GetStringUTFChars(text, nullptr);
  if (!chars) return JNI_FALSE;
  layoutMirrorSetText(state, static_cast<int>(nodeId), chars);
  env->ReleaseStringUTFChars(text, chars);
  fontId = fontId;
  return JNI_TRUE;
#endif
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_zynth_kit_runtime_JSBridge_axonSetMeasureHandler(
    JNIEnv *,
    jobject,
    jlong ptr,
    jint nodeId,
    jboolean enabled) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return JNI_FALSE;
  RuntimeState *state = stateFor(runtime);
  if (!state) return JNI_FALSE;
#if ZYNTH_LAYOUT_ENGINE_AXON
  if (!state->axonEngine) return JNI_FALSE;
  std::size_t nativeId = axonEnsureNode(state, static_cast<int>(nodeId));
  if (nativeId == std::numeric_limits<std::size_t>::max()) return JNI_FALSE;
  return axon_node_set_measure_callback(state->axonEngine, nativeId, enabled == JNI_TRUE)
      ? JNI_TRUE
      : JNI_FALSE;
#elif ZYNTH_LAYOUT_ENGINE_YOGA
  if (!state->yogaRuntime) return JNI_FALSE;
  zynth_yoga_runtime_set_measure_handler(
      state->yogaRuntime,
      axonResolveTreeNodeId(state, static_cast<int>(nodeId)),
      enabled == JNI_TRUE);
  return JNI_TRUE;
#else
  return JNI_FALSE;
#endif
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_evaluateScript(JNIEnv *env, jobject, jlong ptr, jstring code, jstring sourceUrl) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !code) return;
  const char *utf8 = env->GetStringUTFChars(code, nullptr);
  std::string script = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(code, utf8);
  const char *source = sourceUrl ? env->GetStringUTFChars(sourceUrl, nullptr) : nullptr;
  auto buffer = std::make_shared<StringBuffer>(script);
  auto state = sharedStateFor(runtime);
  try {
    runtime->evaluateJavaScript(buffer, source ? source : "<android>");
  } catch (const facebook::jsi::JSError &error) {
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown evaluateScript failure");
  }
  if (sourceUrl && source) env->ReleaseStringUTFChars(sourceUrl, source);
}

class ZynthBytecodeBuffer : public facebook::jsi::Buffer {
public:
    ZynthBytecodeBuffer(std::vector<uint8_t> data) : data_(std::move(data)) {}
    const uint8_t *data() const override { return data_.data(); }
    size_t size() const override { return data_.size(); }
private:
    std::vector<uint8_t> data_;
};

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_loadBytecode(JNIEnv *env, jobject, jlong ptr, jbyteArray bytecode, jstring sourceUrl) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !bytecode) return;

  jsize len = env->GetArrayLength(bytecode);
  if (len == 0) return;

  jbyte *bytes = env->GetByteArrayElements(bytecode, nullptr);
  if (!bytes) return;

  std::vector<uint8_t> data(len);
  std::memcpy(data.data(), bytes, len);
  
  env->ReleaseByteArrayElements(bytecode, bytes, JNI_ABORT);

  const char *source = sourceUrl ? env->GetStringUTFChars(sourceUrl, nullptr) : nullptr;
  
  auto buffer = std::make_shared<ZynthBytecodeBuffer>(std::move(data));
  auto state = sharedStateFor(runtime);
  try {
    runtime->evaluateJavaScript(buffer, source ? source : "main.hbc");
  } catch (const facebook::jsi::JSError &e) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthRuntime", "Failed to load bytecode: %s", e.getMessage().c_str());
    std::string message = e.getMessage();
    std::string stack = e.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &e) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthRuntime", "Failed to load bytecode: %s", e.what());
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", e.what());
  } catch (...) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthRuntime", "Failed to load bytecode: Unknown error");
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown bytecode evaluation failure");
  }
  if (sourceUrl && source) env->ReleaseStringUTFChars(sourceUrl, source);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_callGlobalDouble(JNIEnv *env, jobject, jlong ptr, jstring name, jdouble value) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string propName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  Runtime &rt = *runtime;
  auto propId = PropNameID::forAscii(rt, propName.c_str());
  if (!rt.global().hasProperty(rt, propId)) return;
  Value fnVal = rt.global().getProperty(rt, propId);
  if (!fnVal.isObject() || !fnVal.asObject(rt).isFunction(rt)) return;
  Function fn = fnVal.asObject(rt).asFunction(rt);
  Value arg(static_cast<double>(value));
  auto callFn = static_cast<Value (Function::*)(Runtime&, const Value*, size_t) const>(&Function::call);
  try {
    (fn.*callFn)(rt, &arg, 1);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown callGlobalDouble failure");
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_callGlobalFrame(JNIEnv *env,
                                                    jobject,
                                                    jlong ptr,
                                                    jstring name,
                                                    jdouble frameMs,
                                                    jdouble layoutMs,
                                                    jboolean overBudget,
                                                    jint nodeCount) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string propName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  Runtime &rt = *runtime;
  auto propId = PropNameID::forAscii(rt, propName.c_str());
  if (!rt.global().hasProperty(rt, propId)) return;
  Value fnVal = rt.global().getProperty(rt, propId);
  if (!fnVal.isObject() || !fnVal.asObject(rt).isFunction(rt)) return;
  Function fn = fnVal.asObject(rt).asFunction(rt);
  Value args[] = {
    Value((double)frameMs),
    Value((double)layoutMs),
    Value((bool)(overBudget == JNI_TRUE)),
    Value((double)nodeCount),
  };
  auto callFn = static_cast<Value (Function::*)(Runtime&, const Value*, size_t) const>(&Function::call);
  try {
    (fn.*callFn)(rt, args, 4);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown callGlobalFrame failure");
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_emitEvent(JNIEnv *env,
                                              jobject,
                                              jlong ptr,
                                              jstring name,
                                              jstring payloadJson) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  Runtime &rt = *runtime;
  if (!rt.global().hasProperty(rt, "ZynthNativeEmitter")) return;
  Object emitter = rt.global().getPropertyAsObject(rt, "ZynthNativeEmitter");
  if (!emitter.hasProperty(rt, "emit")) return;
  Function emitFn = emitter.getPropertyAsFunction(rt, "emit");
  Value payload = Value::undefined();
  if (payloadJson) {
    const char *payloadUtf8 = env->GetStringUTFChars(payloadJson, nullptr);
    std::string payloadStr = payloadUtf8 ? payloadUtf8 : "";
    env->ReleaseStringUTFChars(payloadJson, payloadUtf8);
    if (!payloadStr.empty()) {
      try {
        Object json = rt.global().getPropertyAsObject(rt, "JSON");
        Function parse = json.getPropertyAsFunction(rt, "parse");
        String jsonStr = String::createFromUtf8(rt, payloadStr);
        payload = parse.call(rt, jsonStr);
      } catch (...) {
        payload = Value::undefined();
      }
    }
  }
  try {
    emitFn.call(rt, String::createFromUtf8(rt, eventName), payload);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (const std::exception &error) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", error.what());
  } catch (...) {
    auto state = sharedStateFor(runtime);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", "Unknown emitEvent failure");
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokePressEvent(JNIEnv *env,
                                                     jobject,
                                                     jlong runtimePtr,
                                                     jint nodeId,
                                                     jstring name,
                                                     jdouble x,
                                                     jdouble y,
                                                     jdouble screenX,
                                                     jdouble screenY,
                                                     jdouble durationMs,
                                                     jdouble timestampMs,
                                                     jboolean cancelled) {
  if (!name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  if (!runtime) return;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{runtime, static_cast<int>(nodeId), eventName});
    if (it == gHandlers.end()) return;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  Object payload(rt);
  payload.setProperty(rt, "x", static_cast<double>(x));
  payload.setProperty(rt, "y", static_cast<double>(y));
  payload.setProperty(rt, "screenX", static_cast<double>(screenX));
  payload.setProperty(rt, "screenY", static_cast<double>(screenY));
  if (durationMs >= 0) {
    payload.setProperty(rt, "durationMs", static_cast<double>(durationMs));
  }
  payload.setProperty(rt, "timestamp", static_cast<double>(timestampMs));
  payload.setProperty(rt, "pointerType", String::createFromUtf8(rt, "touch"));
  payload.setProperty(rt, "canceled", cancelled == JNI_TRUE);
  try {
    handler->call(rt, payload);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeEvent(JNIEnv *env,
                                                jobject,
                                                jlong runtimePtr,
                                                jint nodeId,
                                                jstring name,
                                                jstring payloadJson) {
  if (!name) return;
  const char *utf8 = env->GetStringUTFChars(name, nullptr);
  std::string eventName = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(name, utf8);
  if (eventName.empty()) return;
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  if (!runtime) return;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{runtime, static_cast<int>(nodeId), eventName});
    if (it == gHandlers.end()) return;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  Value arg = Value::undefined();
  if (payloadJson) {
    const char *payloadUtf8 = env->GetStringUTFChars(payloadJson, nullptr);
    std::string payload = payloadUtf8 ? payloadUtf8 : "";
    env->ReleaseStringUTFChars(payloadJson, payloadUtf8);
    if (!payload.empty()) {
      try {
        Object json = rt.global().getPropertyAsObject(rt, "JSON");
        Function parse = json.getPropertyAsFunction(rt, "parse");
        String jsonStr = String::createFromUtf8(rt, payload);
        arg = parse.call(rt, jsonStr);
      } catch (...) {
        arg = Value::undefined();
      }
    }
  }
  try {
    handler->call(rt, arg);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (...) {
    return;
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeTimer(JNIEnv *,
                                                jobject,
                                                jlong ptr,
                                                jint timerId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  
  std::shared_ptr<Function> callback;
  std::vector<Value> args;
  bool isInterval = false;

  {
    std::shared_ptr<TimerContext> ctx;
    {
      std::lock_guard<std::mutex> lock(gStateMutex);
      auto it = gStates.find(runtime);
      if (it != gStates.end() && it->second) {
        ctx = it->second->timerContext;
      }
    }
    
    if (ctx) {
      std::lock_guard<std::mutex> lock(ctx->mutex);
      auto &timers = ctx->timers;
      auto tit = timers.find(timerId);
      if (tit != timers.end()) {
        callback = tit->second.callback;
        Runtime &rt = *runtime;
        for (const auto &v : tit->second.args) {
          args.emplace_back(Value(rt, v));
        }
        isInterval = tit->second.repeat;
        
        if (!isInterval) {
          timers.erase(tit);
        }
      }
    }
  }

  if (callback) {
    Runtime &rt = *runtime;
    const Value *argsPtr = args.empty() ? nullptr : args.data();
    try {
      callback->call(rt, argsPtr, args.size());
    } catch (const JSError &error) {
      __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "Timer error: %s", error.getMessage().c_str());
      auto state = sharedStateFor(runtime);
      std::string message = error.getMessage();
      std::string stack = error.getStack();
      std::string combined = stack.empty() ? message : (message + "\n" + stack);
      emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
    } catch (...) {
      __android_log_print(ANDROID_LOG_ERROR, "ZynthJS", "Timer exception");
    }
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_registerWorkletOnUiRuntime(JNIEnv *,
                                                               jobject,
                                                               jlong ptr,
                                                               jint workletId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;
  registerWorkletOnUIRuntime(state, workletId);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_runWorkletOnUiRuntime(JNIEnv *,
                                                          jobject,
                                                          jlong ptr,
                                                          jint workletId) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;
  runWorkletOnUIRuntime(state, workletId);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_zynth_kit_runtime_JSBridge_runInputHandlerOnUiRuntime(JNIEnv *env,
                                                               jobject,
                                                               jlong ptr,
                                                               jint workletId,
                                                               jstring currentText,
                                                               jstring newInput,
                                                               jstring proposedText) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime) return nullptr;
  auto state = sharedStateFor(runtime);
  if (!state) return nullptr;

  const char *currentUtf8 = currentText ? env->GetStringUTFChars(currentText, nullptr) : nullptr;
  const char *inputUtf8 = newInput ? env->GetStringUTFChars(newInput, nullptr) : nullptr;
  const char *proposedUtf8 = proposedText ? env->GetStringUTFChars(proposedText, nullptr) : nullptr;
  std::string current = currentUtf8 ? currentUtf8 : "";
  std::string input = inputUtf8 ? inputUtf8 : "";
  std::string proposed = proposedUtf8 ? proposedUtf8 : "";
  if (currentText && currentUtf8) env->ReleaseStringUTFChars(currentText, currentUtf8);
  if (newInput && inputUtf8) env->ReleaseStringUTFChars(newInput, inputUtf8);
  if (proposedText && proposedUtf8) {
    env->ReleaseStringUTFChars(proposedText, proposedUtf8);
  }

  auto result = runInputHandlerWorkletOnUIRuntime(
      state, workletId, current, input, proposed);
  if (!result.has_value()) return nullptr;
  return env->NewStringUTF(result->c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEvent(JNIEnv *,
                                                      jobject,
                                                      jlong runtimePtr,
                                                      jint nodeId,
                                                      jdouble x,
                                                      jdouble y,
                                                      jdouble width,
                                                      jdouble height) {
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  if (!runtime) return;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    auto it = gHandlers.find(HandlerKey{runtime, static_cast<int>(nodeId), "onLayout"});
    if (it == gHandlers.end()) return;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  Object payload(rt);
  Object nativeEvent(rt);
  Object layout(rt);
  layout.setProperty(rt, "x", static_cast<double>(x));
  layout.setProperty(rt, "y", static_cast<double>(y));
  layout.setProperty(rt, "width", static_cast<double>(width));
  layout.setProperty(rt, "height", static_cast<double>(height));
  nativeEvent.setProperty(rt, "layout", layout);
  payload.setProperty(rt, "nativeEvent", nativeEvent);
  try {
    handler->call(rt, payload);
  } catch (const JSError &error) {
    auto state = sharedStateFor(runtime);
    std::string message = error.getMessage();
    std::string stack = error.getStack();
    std::string combined = stack.empty() ? message : (message + "\n" + stack);
    emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
  } catch (...) {
    return;
  }
}

static void invokeLayoutEventsBatchInternal(
    JNIEnv *env,
    facebook::hermes::HermesRuntime *runtime,
    jdoubleArray payload,
    jsize requestedLength) {
  if (!env || !runtime || !payload) return;
  jsize availableLength = env->GetArrayLength(payload);
  jsize length = requestedLength >= 0 ? std::min(availableLength, requestedLength) : availableLength;
  if (length < 5) return;
  jdouble *data = env->GetDoubleArrayElements(payload, nullptr);
  if (!data) return;
  struct LayoutDispatchEntry {
    std::shared_ptr<Function> handler;
    double x = 0.0;
    double y = 0.0;
    double width = 0.0;
    double height = 0.0;
  };
  std::vector<LayoutDispatchEntry> dispatchEntries;
  dispatchEntries.reserve(static_cast<size_t>(length / 5));
  {
    std::lock_guard<std::mutex> lock(gHandlerMutex);
    for (jsize i = 0; i + 4 < length; i += 5) {
      int nodeId = static_cast<int>(data[i]);
      auto it = gHandlers.find(HandlerKey{runtime, nodeId, "onLayout"});
      if (it == gHandlers.end() || !it->second.handler) continue;
      LayoutDispatchEntry entry;
      entry.handler = it->second.handler;
      entry.x = data[i + 1];
      entry.y = data[i + 2];
      entry.width = data[i + 3];
      entry.height = data[i + 4];
      dispatchEntries.push_back(std::move(entry));
    }
  }
  for (const auto &entry : dispatchEntries) {
    if (!entry.handler) continue;
    Runtime &rt = *runtime;
    Object payloadObj(rt);
    Object nativeEvent(rt);
    Object layout(rt);
    layout.setProperty(rt, "x", entry.x);
    layout.setProperty(rt, "y", entry.y);
    layout.setProperty(rt, "width", entry.width);
    layout.setProperty(rt, "height", entry.height);
    nativeEvent.setProperty(rt, "layout", layout);
    payloadObj.setProperty(rt, "nativeEvent", nativeEvent);
    try {
      entry.handler->call(rt, payloadObj);
    } catch (const JSError &error) {
      auto state = sharedStateFor(runtime);
      std::string message = error.getMessage();
      std::string stack = error.getStack();
      std::string combined = stack.empty() ? message : (message + "\n" + stack);
      emitDevtoolsEvent(state.get(), "error/js", "error", "js", combined);
    } catch (...) {
      continue;
    }
  }
  env->ReleaseDoubleArrayElements(payload, data, JNI_ABORT);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEventsBatch(JNIEnv *env,
                                                            jobject,
                                                            jlong runtimePtr,
                                                            jdoubleArray payload) {
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  invokeLayoutEventsBatchInternal(env, runtime, payload, -1);
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_invokeLayoutEventsBatchSlice(JNIEnv *env,
                                                                 jobject,
                                                                 jlong runtimePtr,
                                                                 jdoubleArray payload,
                                                                 jint length) {
  facebook::hermes::HermesRuntime *runtime =
      reinterpret_cast<facebook::hermes::HermesRuntime *>(runtimePtr);
  invokeLayoutEventsBatchInternal(env, runtime, payload, static_cast<jsize>(length));
}

static jobject jsValueToJava(JNIEnv *env, Runtime &rt, RuntimeState *state, const Value &value) {
  if (value.isString()) {
    return env->NewStringUTF(value.asString(rt).utf8(rt).c_str());
  }
  if (value.isNumber()) {
    if (!state->doubleClass || !state->doubleConstructor) return nullptr;
    return env->NewObject(state->doubleClass, state->doubleConstructor, value.asNumber());
  }
  if (value.isBool()) {
    if (!state->booleanClass || !state->booleanConstructor) return nullptr;
    return env->NewObject(state->booleanClass, state->booleanConstructor, value.getBool());
  }
  if (value.isObject()) {
    if (!state->jsonObjectClass || !state->jsonObjectConstructor) return nullptr;
    // JSON.stringify the object
    try {
      Object json = rt.global().getPropertyAsObject(rt, "JSON");
      Function stringify = json.getPropertyAsFunction(rt, "stringify");
      Value result = stringify.call(rt, value);
      if (result.isString()) {
        jstring jsonStr = env->NewStringUTF(result.asString(rt).utf8(rt).c_str());
        jobject jsonObj = env->NewObject(state->jsonObjectClass, state->jsonObjectConstructor, jsonStr);
        env->DeleteLocalRef(jsonStr);
        return jsonObj;
      }
    } catch (...) {
      return nullptr;
    }
  }
  return nullptr; // null/undefined
}

static Value javaJsonToJs(JNIEnv *env, Runtime &rt, jobject jsonObject) {
  if (!jsonObject) return Value::null();
  jmethodID toString = env->GetMethodID(env->GetObjectClass(jsonObject), "toString", "()Ljava/lang/String;");
  jstring jsonStr = (jstring)env->CallObjectMethod(jsonObject, toString);
  if (!jsonStr) return Value::null();
  
  const char *utf8 = env->GetStringUTFChars(jsonStr, nullptr);
  std::string str = utf8 ? utf8 : "";
  env->ReleaseStringUTFChars(jsonStr, utf8);
  env->DeleteLocalRef(jsonStr);

  try {
    Object json = rt.global().getPropertyAsObject(rt, "JSON");
    Function parse = json.getPropertyAsFunction(rt, "parse");
    return parse.call(rt, String::createFromUtf8(rt, str));
  } catch (...) {
    return Value::undefined();
  }
}

extern "C" JNIEXPORT void JNICALL
Java_com_zynth_kit_runtime_JSBridge_installModuleRegistry(JNIEnv *env, jobject, jlong ptr, jobject registry) {
  auto *runtime = reinterpret_cast<facebook::hermes::HermesRuntime *>(ptr);
  if (!runtime || !registry) return;
  auto state = sharedStateFor(runtime);
  if (!state) return;

  state->moduleRegistry = env->NewGlobalRef(registry);
  jclass regClass = env->GetObjectClass(registry);
  state->moduleRegistryClass = static_cast<jclass>(env->NewGlobalRef(regClass));
  state->moduleCall = env->GetMethodID(state->moduleRegistryClass, "call", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;)Lorg/json/JSONObject;");
  state->moduleCallSync = env->GetMethodID(state->moduleRegistryClass, "callSync", "(Ljava/lang/String;Ljava/lang/String;[Ljava/lang/Object;)Ljava/lang/Object;");

  jclass jsonCls = env->FindClass("org/json/JSONObject");
  state->jsonObjectClass = static_cast<jclass>(env->NewGlobalRef(jsonCls));
  state->jsonObjectConstructor = env->GetMethodID(state->jsonObjectClass, "<init>", "(Ljava/lang/String;)V");
  env->DeleteLocalRef(jsonCls);

  jclass doubleCls = env->FindClass("java/lang/Double");
  state->doubleClass = static_cast<jclass>(env->NewGlobalRef(doubleCls));
  state->doubleConstructor = env->GetMethodID(state->doubleClass, "<init>", "(D)V");
  env->DeleteLocalRef(doubleCls);

  jclass boolCls = env->FindClass("java/lang/Boolean");
  state->booleanClass = static_cast<jclass>(env->NewGlobalRef(boolCls));
  state->booleanConstructor = env->GetMethodID(state->booleanClass, "<init>", "(Z)V");
  env->DeleteLocalRef(boolCls);

  jclass stringCls = env->FindClass("java/lang/String");
  if (stringCls && !state->stringClass) {
    state->stringClass = static_cast<jclass>(env->NewGlobalRef(stringCls));
  }
  if (stringCls) {
    env->DeleteLocalRef(stringCls);
  }

  Runtime &rt = *runtime;

  auto callFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "call"), 2,
      [state, runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || !state->moduleRegistry || !state->moduleCall) return Value::undefined();
        if (count < 2 || !args[0].isString() || !args[1].isString()) return Value::undefined();
        
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        std::string moduleName = args[0].asString(rt).utf8(rt);
        std::string methodName = args[1].asString(rt).utf8(rt);
        jstring jModule = env->NewStringUTF(moduleName.c_str());
        jstring jMethod = env->NewStringUTF(methodName.c_str());

        // Marshal args
        size_t argCount = count > 2 ? count - 2 : 0;
        jobjectArray jArgs = nullptr;
        if (argCount > 0) {
          jclass objCls = env->FindClass("java/lang/Object");
          jArgs = env->NewObjectArray(static_cast<jsize>(argCount), objCls, nullptr);
          env->DeleteLocalRef(objCls);
          
          for (size_t i = 0; i < argCount; i++) {
            jobject jArg = jsValueToJava(env, rt, state.get(), args[i + 2]);
            env->SetObjectArrayElement(jArgs, static_cast<jsize>(i), jArg);
            if (jArg) env->DeleteLocalRef(jArg);
          }
        } else {
             jclass objCls = env->FindClass("java/lang/Object");
             jArgs = env->NewObjectArray(0, objCls, nullptr);
             env->DeleteLocalRef(objCls);
        }

        jobject resultObj = env->CallObjectMethod(state->moduleRegistry, state->moduleCall, jModule, jMethod, jArgs);
        
        env->DeleteLocalRef(jModule);
        env->DeleteLocalRef(jMethod);
        env->DeleteLocalRef(jArgs);

        Value result = javaJsonToJs(env, rt, resultObj);
        if (resultObj) env->DeleteLocalRef(resultObj);
        return result;
      });

  auto callSyncFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "callSync"), 2,
      [state, runtime](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (!state || !state->moduleRegistry || !state->moduleCallSync) return Value::undefined();
        if (count < 2 || !args[0].isString() || !args[1].isString()) return Value::undefined();
        
        JNIEnv *env = getEnv();
        if (!env) return Value::undefined();

        std::string moduleName = args[0].asString(rt).utf8(rt);
        std::string methodName = args[1].asString(rt).utf8(rt);
        jstring jModule = env->NewStringUTF(moduleName.c_str());
        jstring jMethod = env->NewStringUTF(methodName.c_str());

        // Marshal args
        size_t argCount = count > 2 ? count - 2 : 0;
        jobjectArray jArgs = nullptr;
        if (argCount > 0) {
          jclass objCls = env->FindClass("java/lang/Object");
          jArgs = env->NewObjectArray(static_cast<jsize>(argCount), objCls, nullptr);
          env->DeleteLocalRef(objCls);
          
          for (size_t i = 0; i < argCount; i++) {
            jobject jArg = jsValueToJava(env, rt, state.get(), args[i + 2]);
            env->SetObjectArrayElement(jArgs, static_cast<jsize>(i), jArg);
            if (jArg) env->DeleteLocalRef(jArg);
          }
        } else {
             jclass objCls = env->FindClass("java/lang/Object");
             jArgs = env->NewObjectArray(0, objCls, nullptr);
             env->DeleteLocalRef(objCls);
        }

        jobject resultObj = env->CallObjectMethod(state->moduleRegistry, state->moduleCallSync, jModule, jMethod, jArgs);
        
        env->DeleteLocalRef(jModule);
        env->DeleteLocalRef(jMethod);
        env->DeleteLocalRef(jArgs);

        if (!resultObj) return Value::null();

        if (env->IsInstanceOf(resultObj, state->stringClass)) {
            const char *utf8 = env->GetStringUTFChars((jstring)resultObj, nullptr);
            auto val = String::createFromUtf8(rt, utf8 ? utf8 : "");
            if (utf8) env->ReleaseStringUTFChars((jstring)resultObj, utf8);
            env->DeleteLocalRef(resultObj);
            return val;
        }

        Value result = javaJsonToJs(env, rt, resultObj);
        env->DeleteLocalRef(resultObj);
        return result;
      });

  Object modules(rt);
  modules.setProperty(rt, "call", callFn);
  modules.setProperty(rt, "callSync", callSyncFn);
  rt.global().setProperty(rt, "__modules", modules);
}
