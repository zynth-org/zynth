#import <Foundation/Foundation.h>

#import <hermes/hermes.h>
#import <jsi/jsi.h>

#import "ZynthJSIPluginRegistry.h"

using namespace facebook::jsi;

@class ZynthSkiaView;

@interface ZynthSkiaView : UIView
- (void)markSurfaceReady;
- (void)resetSurface;
- (void)submitCommands:(NSArray<NSDictionary *> *)rawCommands;
- (void)submitFrame:(NSDictionary *)rawFrame;
- (void)invalidateSurface;
- (void)setFrameLoopEnabled:(BOOL)enabled;
@end

@interface ZynthSkiaViewRegistry : NSObject
+ (instancetype)sharedInstance;
- (ZynthSkiaView *_Nullable)viewForNodeId:(int)nodeId;
@end

namespace {
static const char *kSkiaKey = "__zynth_skia";

static id ZynthSkiaParseJSONString(Runtime &rt, const Value &value) {
  try {
    Object json = rt.global().getPropertyAsObject(rt, "JSON");
    Function stringify = json.getPropertyAsFunction(rt, "stringify");
    Value result = stringify.call(rt, value);
    if (!result.isString()) return nil;
    auto utf8 = result.asString(rt).utf8(rt);
    NSData *data = [NSData dataWithBytes:utf8.data() length:utf8.size()];
    if (!data) return nil;
    return [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:nil];
  } catch (...) {
    return nil;
  }
}

static int ZynthSkiaReadNodeId(const Value *args, size_t count) {
  if (count < 1 || !args[0].isNumber()) return -1;
  return (int)args[0].asNumber();
}
} // namespace

@interface ZynthSkiaJSIInstaller : NSObject
@end

@implementation ZynthSkiaJSIInstaller

+ (void)load {
  ZynthRegisterJSIPluginInstaller([](ZynthHermesRuntimeHost *host, Runtime &rt) {
    host = host;
    auto createSurface = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "createSurface"), 1,
        [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          int nodeId = ZynthSkiaReadNodeId(args, count);
          if (nodeId <= 0) return Value(false);
          ZynthSkiaView *view = [[ZynthSkiaViewRegistry sharedInstance] viewForNodeId:nodeId];
          if (!view) return Value(false);
          [view markSurfaceReady];
          return Value(true);
        });

    auto disposeSurface = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "disposeSurface"), 1,
        [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          int nodeId = ZynthSkiaReadNodeId(args, count);
          if (nodeId <= 0) return Value(false);
          ZynthSkiaView *view = [[ZynthSkiaViewRegistry sharedInstance] viewForNodeId:nodeId];
          if (!view) return Value(false);
          [view resetSurface];
          return Value(true);
        });

    auto submitDrawCommands = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "submitDrawCommands"), 2,
        [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          int nodeId = ZynthSkiaReadNodeId(args, count);
          if (nodeId <= 0 || count < 2) return Value(false);
          ZynthSkiaView *view = [[ZynthSkiaViewRegistry sharedInstance] viewForNodeId:nodeId];
          if (!view) return Value(false);
          id parsed = ZynthSkiaParseJSONString(rt, args[1]);
          if ([parsed isKindOfClass:[NSArray class]]) {
            [view submitCommands:(NSArray<NSDictionary *> *)parsed];
          } else {
            [view submitCommands:@[]];
          }
          return Value(true);
        });

    auto submitFrame = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "submitFrame"), 2,
        [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
          int nodeId = ZynthSkiaReadNodeId(args, count);
          if (nodeId <= 0 || count < 2) return Value(false);
          ZynthSkiaView *view = [[ZynthSkiaViewRegistry sharedInstance] viewForNodeId:nodeId];
          if (!view) return Value(false);
          id parsed = ZynthSkiaParseJSONString(rt, args[1]);
          if ([parsed isKindOfClass:[NSDictionary class]]) {
            [view submitFrame:(NSDictionary *)parsed];
          }
          return Value(true);
        });

    auto invalidateSurface = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "invalidateSurface"), 1,
        [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          int nodeId = ZynthSkiaReadNodeId(args, count);
          if (nodeId <= 0) return Value(false);
          ZynthSkiaView *view = [[ZynthSkiaViewRegistry sharedInstance] viewForNodeId:nodeId];
          if (!view) return Value(false);
          [view invalidateSurface];
          return Value(true);
        });

    auto setFrameLoopEnabled = Function::createFromHostFunction(
        rt, PropNameID::forAscii(rt, "setFrameLoopEnabled"), 2,
        [](Runtime &, const Value &, const Value *args, size_t count) -> Value {
          int nodeId = ZynthSkiaReadNodeId(args, count);
          if (nodeId <= 0 || count < 2 || !args[1].isBool()) return Value(false);
          ZynthSkiaView *view = [[ZynthSkiaViewRegistry sharedInstance] viewForNodeId:nodeId];
          if (!view) return Value(false);
          [view setFrameLoopEnabled:args[1].getBool()];
          return Value(true);
        });

    Object skia(rt);
    skia.setProperty(rt, "createSurface", createSurface);
    skia.setProperty(rt, "disposeSurface", disposeSurface);
    skia.setProperty(rt, "submitDrawCommands", submitDrawCommands);
    skia.setProperty(rt, "submitFrame", submitFrame);
    skia.setProperty(rt, "invalidateSurface", invalidateSurface);
    skia.setProperty(rt, "setFrameLoopEnabled", setFrameLoopEnabled);
    rt.global().setProperty(rt, kSkiaKey, skia);
  });
}

@end
