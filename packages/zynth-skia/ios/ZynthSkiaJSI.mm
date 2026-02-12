#import <Foundation/Foundation.h>

#import <jsi/jsi.h>

#import "ZynthHermesRuntimeHost.h"
#import "ZynthJSIPluginRegistry.h"
#import "ZynthUIManager+Private.h"
#import "ZynthSkiaRendererBridge.h"

#import <algorithm>
#import <string>
#import <vector>

using namespace facebook::jsi;

@interface ZynthSkiaView : UIView
- (void)setSurfaceAvailable:(BOOL)available;
- (void)setFrameLoopEnabledValue:(BOOL)enabled;
- (void)markSurfaceDirty;
@end

namespace {
static const char *kSkiaKey = "__zynth_skia";
static bool gSharedSignalCallbackRegistered = false;

static ZynthSkiaView *viewForNode(ZynthHermesRuntimeHost *host, int nodeId) {
  if (!host) return nil;
  ZynthUIManager *manager = [host uiManager];
  if (!manager) return nil;
  UIView *view = [manager viewForNodeId:@(nodeId)];
  if (![view isKindOfClass:[ZynthSkiaView class]]) return nil;
  return (ZynthSkiaView *)view;
}

static bool onMainSyncBool(dispatch_block_t block) {
  if (!block) return false;
  if ([NSThread isMainThread]) {
    block();
    return true;
  }

  __block bool finished = false;
  dispatch_sync(dispatch_get_main_queue(), ^{
    block();
    finished = true;
  });
  return finished;
}

static bool createSurface(ZynthHermesRuntimeHost *host, int nodeId) {
  if (nodeId <= 0 || !host) return false;
  bool created = [ZynthSkiaRendererBridge createSurface:nodeId];
  if (!created) return false;

  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) return;
    [view setSurfaceAvailable:YES];
  });
  return true;
}

static bool disposeSurface(ZynthHermesRuntimeHost *host, int nodeId) {
  if (nodeId <= 0 || !host) return false;
  [ZynthSkiaRendererBridge disposeSurface:nodeId];

  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) return;
    [view setSurfaceAvailable:NO];
  });
  return true;
}

static void markDirtyIfPresent(ZynthHermesRuntimeHost *host, int nodeId) {
  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) return;
    [view markSurfaceDirty];
  });
}

static bool setFrameLoopEnabled(ZynthHermesRuntimeHost *host, int nodeId, bool enabled) {
  bool stored = [ZynthSkiaRendererBridge setFrameLoopEnabled:enabled forNode:nodeId];
  if (!stored) return false;

  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) return;
    [view setFrameLoopEnabledValue:enabled];
  });
  return true;
}

static bool submitPacked(
    ZynthHermesRuntimeHost *host,
    int nodeId,
    const double *ops,
    size_t opCount,
    std::vector<std::string> strings) {
  if (nodeId <= 0 || !host || ops == nullptr) return false;

  NSMutableArray<NSString *> *stringTable = [NSMutableArray arrayWithCapacity:strings.size()];
  for (const auto &entry : strings) {
    [stringTable addObject:[NSString stringWithUTF8String:entry.c_str()]];
  }

  bool stored = [ZynthSkiaRendererBridge submitPacked:ops
                                               opCount:static_cast<NSInteger>(opCount)
                                           stringTable:stringTable
                                               forNode:nodeId];
  if (!stored) return false;
  markDirtyIfPresent(host, nodeId);
  return true;
}

static void installSkiaBridge(ZynthHermesRuntimeHost *host, Runtime &rt) {
  [ZynthSkiaRendererBridge setRuntimeState:(__bridge void *)host];
  if (!gSharedSignalCallbackRegistered) {
    ZynthRegisterSharedSignalChangedCallback(+[](void *state, int signalId) {
      if (signalId <= 0) return;
      ZynthHermesRuntimeHost *host = (__bridge ZynthHermesRuntimeHost *)state;
      if (!host) return;
      NSArray<NSNumber *> *nodeIds = [ZynthSkiaRendererBridge surfaceNodeIdsForSignalId:signalId];
      for (NSNumber *nodeId in nodeIds) {
        if (![nodeId isKindOfClass:[NSNumber class]]) continue;
        markDirtyIfPresent(host, [nodeId intValue]);
      }
    });
    gSharedSignalCallbackRegistered = true;
  }

  auto createSurfaceFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "createSurface"),
      1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        return Value(createSurface(host, (int)args[0].asNumber()));
      });

  auto disposeSurfaceFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "disposeSurface"),
      1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        return Value(disposeSurface(host, (int)args[0].asNumber()));
      });

  auto submitPackedFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "submitDrawCommandsPacked"),
      4,
      [host](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 4 || !args[0].isNumber() || !args[1].isObject() ||
            !args[2].isNumber() || !args[3].isObject()) {
          return Value(false);
        }

        Object opsObject = args[1].asObject(rt);
        if (!opsObject.isArrayBuffer(rt)) return Value(false);

        Object stringsObject = args[3].asObject(rt);
        if (!stringsObject.isArray(rt)) return Value(false);

        ArrayBuffer buffer = opsObject.getArrayBuffer(rt);
        size_t availableOps = buffer.size(rt) / sizeof(double);
        size_t requestedOps = (size_t)std::max(0.0, args[2].asNumber());
        size_t opCount = std::min(availableOps, requestedOps);

        std::vector<std::string> strings;
        Array stringArray = stringsObject.asArray(rt);
        size_t stringCount = stringArray.length(rt);
        strings.reserve(stringCount);
        for (size_t i = 0; i < stringCount; i += 1) {
          Value entry = stringArray.getValueAtIndex(rt, i);
          if (entry.isString()) {
            strings.push_back(entry.asString(rt).utf8(rt));
          } else {
            strings.emplace_back();
          }
        }

        const auto *ops = reinterpret_cast<const double *>(buffer.data(rt));
        return Value(submitPacked(host, (int)args[0].asNumber(), ops, opCount, std::move(strings)));
      });

  auto submitDrawCommandsFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "submitDrawCommands"),
      2,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        int nodeId = (int)args[0].asNumber();
        if (![ZynthSkiaRendererBridge hasSurface:nodeId]) return Value(false);
        markDirtyIfPresent(host, nodeId);
        return Value(true);
      });

  auto invalidateSurfaceFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "invalidateSurface"),
      1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        int nodeId = (int)args[0].asNumber();
        if (![ZynthSkiaRendererBridge hasSurface:nodeId]) return Value(false);
        markDirtyIfPresent(host, nodeId);
        return Value(true);
      });

  auto setFrameLoopEnabledFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "setFrameLoopEnabled"),
      2,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isBool()) return Value(false);
        return Value(setFrameLoopEnabled(host, (int)args[0].asNumber(), args[1].getBool()));
      });

  auto submitFrameFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "submitFrame"),
      2,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        int nodeId = (int)args[0].asNumber();
        if (![ZynthSkiaRendererBridge hasSurface:nodeId]) return Value(false);
        markDirtyIfPresent(host, nodeId);
        return Value(true);
      });

  auto measureTextFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "measureText"),
      5,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 5 || !args[0].isString() || !args[1].isString() || !args[2].isNumber()
            || !args[3].isString() || (!args[4].isString() && !args[4].isNumber())) {
          return Value(0.0);
        }
        std::string text = args[0].asString(rt).utf8(rt);
        std::string familyName = args[1].asString(rt).utf8(rt);
        double fontSize = args[2].asNumber();
        std::string fontStyle = args[3].asString(rt).utf8(rt);
        std::string fontWeight = args[4].isString()
          ? args[4].asString(rt).utf8(rt)
          : std::to_string((int)args[4].asNumber());

        return Value([ZynthSkiaRendererBridge measureText:[NSString stringWithUTF8String:text.c_str()]
                                               familyName:[NSString stringWithUTF8String:familyName.c_str()]
                                                 fontSize:fontSize
                                                fontStyle:[NSString stringWithUTF8String:fontStyle.c_str()]
                                               fontWeight:[NSString stringWithUTF8String:fontWeight.c_str()]]);
      });

  auto listFontFamiliesFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "listFontFamilies"),
      0,
      [](Runtime &rt, const Value &, const Value *, size_t) -> Value {
        NSArray<NSString *> *families = [ZynthSkiaRendererBridge listFontFamilies];
        Array array(rt, families.count);
        for (NSUInteger index = 0; index < families.count; index += 1) {
          NSString *entry = families[index];
          array.setValueAtIndex(rt, index, String::createFromUtf8(rt, [entry UTF8String]));
        }
        return array;
      });

  auto registerFontFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "registerFont"),
      2,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isString() || !args[1].isObject()) return Value(false);
        NSString *familyName = [NSString stringWithUTF8String:args[0].asString(rt).utf8(rt).c_str()];
        Object bufferObj = args[1].asObject(rt);
        if (!bufferObj.isArrayBuffer(rt)) return Value(false);
        ArrayBuffer buffer = bufferObj.getArrayBuffer(rt);
        NSData *data = [NSData dataWithBytes:buffer.data(rt) length:buffer.size(rt)];
        return Value([ZynthSkiaRendererBridge registerFont:familyName data:data]);
      });

  Object skia(rt);
  Object capabilities(rt);
  capabilities.setProperty(rt, "paths", Value(true));
  capabilities.setProperty(rt, "pathCurves", Value(true));
  capabilities.setProperty(rt, "paintOpacity", Value(true));
  capabilities.setProperty(rt, "paintStrokeCap", Value(true));
  capabilities.setProperty(rt, "paintStrokeJoin", Value(true));
  capabilities.setProperty(rt, "paintStrokeMiter", Value(true));
  capabilities.setProperty(rt, "groupTransforms", Value(true));
  skia.setProperty(rt, "capabilities", capabilities);
  skia.setProperty(rt, "createSurface", createSurfaceFn);
  skia.setProperty(rt, "disposeSurface", disposeSurfaceFn);
  skia.setProperty(rt, "submitDrawCommandsPacked", submitPackedFn);
  skia.setProperty(rt, "submitDrawCommands", submitDrawCommandsFn);
  skia.setProperty(rt, "invalidateSurface", invalidateSurfaceFn);
  skia.setProperty(rt, "setFrameLoopEnabled", setFrameLoopEnabledFn);
  skia.setProperty(rt, "submitFrame", submitFrameFn);
  skia.setProperty(rt, "measureText", measureTextFn);
  skia.setProperty(rt, "listFontFamilies", listFontFamiliesFn);
  skia.setProperty(rt, "registerFont", registerFontFn);

  rt.global().setProperty(rt, kSkiaKey, skia);
}
} // namespace

@interface ZynthSkiaJSI : NSObject
@end

@implementation ZynthSkiaJSI

+ (void)load {
  ZynthRegisterJSIPluginInstaller(installSkiaBridge);
}

@end
