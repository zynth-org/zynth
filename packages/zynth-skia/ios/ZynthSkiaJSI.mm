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

  __block bool ok = false;
  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) {
      ok = false;
      return;
    }
    [view setSurfaceAvailable:YES];
    ok = true;
  });
  return ok;
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

static bool markDirty(ZynthHermesRuntimeHost *host, int nodeId) {
  __block bool ok = false;
  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) {
      ok = false;
      return;
    }
    [view markSurfaceDirty];
    ok = true;
  });
  return ok;
}

static bool setFrameLoopEnabled(ZynthHermesRuntimeHost *host, int nodeId, bool enabled) {
  bool stored = [ZynthSkiaRendererBridge setFrameLoopEnabled:enabled forNode:nodeId];
  if (!stored) return false;

  __block bool ok = false;
  onMainSyncBool(^{
    ZynthSkiaView *view = viewForNode(host, nodeId);
    if (!view) {
      ok = false;
      return;
    }
    [view setFrameLoopEnabledValue:enabled];
    ok = true;
  });
  return ok;
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
  return markDirty(host, nodeId);
}

static void installSkiaBridge(ZynthHermesRuntimeHost *host, Runtime &rt) {
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
        return Value(markDirty(host, (int)args[0].asNumber()));
      });

  auto invalidateSurfaceFn = Function::createFromHostFunction(
      rt,
      PropNameID::forAscii(rt, "invalidateSurface"),
      1,
      [host](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) return Value(false);
        return Value(markDirty(host, (int)args[0].asNumber()));
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
        return Value(markDirty(host, (int)args[0].asNumber()));
      });

  Object skia(rt);
  skia.setProperty(rt, "createSurface", createSurfaceFn);
  skia.setProperty(rt, "disposeSurface", disposeSurfaceFn);
  skia.setProperty(rt, "submitDrawCommandsPacked", submitPackedFn);
  skia.setProperty(rt, "submitDrawCommands", submitDrawCommandsFn);
  skia.setProperty(rt, "invalidateSurface", invalidateSurfaceFn);
  skia.setProperty(rt, "setFrameLoopEnabled", setFrameLoopEnabledFn);
  skia.setProperty(rt, "submitFrame", submitFrameFn);

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
