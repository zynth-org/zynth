#import "ZynthHermesRuntimeHost.h"
#import "ZynthUIBindings.h"
#import "ZynthUIManager.h"
#import "ZynthUICommandsRegistry.h"

#import <hermes/hermes.h>
#import <jsi/jsi.h>

using namespace facebook::jsi;

namespace {
static bool DEBUG_RUNTIME = false;
struct NSDataBuffer final : public Buffer {
  NSData *data_;
  explicit NSDataBuffer(NSData *data) : data_(data) {}
  size_t size() const override { return (size_t)[data_ length]; }
  const uint8_t *data() const override { return (const uint8_t *)[data_ bytes]; }
};

static std::string valueToString(Runtime &rt, const Value &value) {
  if (value.isString()) return value.asString(rt).utf8(rt);
  if (value.isNumber()) return std::to_string(value.asNumber());
  if (value.isBool()) return value.getBool() ? "true" : "false";
  if (value.isNull()) return "null";
  if (value.isUndefined()) return "undefined";
  return "[object]";
}

static void installConsole(Runtime &rt) {
  auto logFn = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "log"), 1,
      [](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        NSMutableArray<NSString *> *parts = [NSMutableArray arrayWithCapacity:count];
        for (size_t i = 0; i < count; i++) {
          std::string str = valueToString(rt, args[i]);
          [parts addObject:[NSString stringWithUTF8String:str.c_str()]];
        }
        NSLog(@"[ZynthJS] %@", [parts componentsJoinedByString:@" "]);
        return Value::undefined();
      });

  Object console(rt);
  console.setProperty(rt, "log", logFn);
  console.setProperty(rt, "warn", logFn);
  console.setProperty(rt, "error", logFn);
  rt.global().setProperty(rt, "console", console);
}

static void installModulesStub(Runtime &rt) {
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

static void installGlobals(Runtime &rt) {
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
} // namespace

@interface ZynthHermesRuntimeHost ()
@property(nonatomic, strong) ZynthUIManager *manager;
@end

@implementation ZynthHermesRuntimeHost {
  std::unique_ptr<facebook::hermes::HermesRuntime> _runtime;
}

- (instancetype)initWithUIManager:(ZynthUIManager *)manager {
  self = [super init];
  if (self) {
    _manager = manager;
    _runtime = facebook::hermes::makeHermesRuntime();
    installConsole(*_runtime);
    installGlobals(*_runtime);
    installModulesStub(*_runtime);
    ZynthInstallUIBindings(*_runtime, manager);
    ZynthInstallUICommandsRegistry(self, *_runtime);
    _runtime->global().setProperty(
        *_runtime, "__ZYNTH_PLATFORM", String::createFromUtf8(*_runtime, "ios"));
  }
  return self;
}

- (BOOL)evaluateString:(NSString *)code
             sourceURL:(NSString *)sourceURL
                error:(NSError *_Nullable *_Nullable)error {
  if (!code) return NO;
  NSData *data = [code dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return NO;
  try {
    auto buffer = std::make_shared<NSDataBuffer>(data);
    const char *source = sourceURL ? sourceURL.UTF8String : "<inline>";
    _runtime->evaluateJavaScript(buffer, source);
    return YES;
  } catch (const JSError &ex) {
    if (error) {
      NSString *message = [NSString stringWithUTF8String:ex.getMessage().c_str()];
      NSDictionary *info = @{ NSLocalizedDescriptionKey : message ?: @"JS error" };
      *error = [NSError errorWithDomain:@"ZynthHermes" code:1 userInfo:info];
    }
    return NO;
  } catch (const std::exception &ex) {
    if (error) {
      NSString *message = [NSString stringWithUTF8String:ex.what()];
      NSDictionary *info = @{ NSLocalizedDescriptionKey : message ?: @"Runtime error" };
      *error = [NSError errorWithDomain:@"ZynthHermes" code:2 userInfo:info];
    }
    return NO;
  }
}

- (BOOL)evaluateBytecode:(NSData *)data
               sourceURL:(NSString *)sourceURL
                  error:(NSError *_Nullable *_Nullable)error {
  if (!data) return NO;
  NSString *string = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (!string) {
    if (error) {
      NSDictionary *info = @{ NSLocalizedDescriptionKey : @"Invalid UTF-8 bytecode payload" };
      *error = [NSError errorWithDomain:@"ZynthHermes" code:3 userInfo:info];
    }
    return NO;
  }
  return [self evaluateString:string sourceURL:sourceURL error:error];
}

- (id _Nullable)callGlobal:(NSString *)name args:(NSArray *)args {
  if (!name) return nil;
  Runtime &rt = *_runtime;
  auto propId = PropNameID::forAscii(rt, name.UTF8String);
  if (!rt.global().hasProperty(rt, propId)) return nil;
  Value value = rt.global().getProperty(rt, propId);
  if (!value.isObject()) return nil;
  Object obj = value.asObject(rt);
  if (!obj.isFunction(rt)) return nil;
  Function fn = obj.asFunction(rt);
  std::vector<Value> callArgs;
  for (id arg in args) {
    if ([arg isKindOfClass:[NSNumber class]]) {
      callArgs.push_back(Value([(NSNumber *)arg doubleValue]));
    } else if ([arg isKindOfClass:[NSString class]]) {
      std::string str = [(NSString *)arg UTF8String];
      callArgs.push_back(String::createFromUtf8(rt, str));
    } else {
      callArgs.push_back(Value::undefined());
    }
  }
  const Value *argsPtr = callArgs.empty() ? nullptr : callArgs.data();
  try {
    fn.call(rt, argsPtr, callArgs.size());
  } catch (const JSError &error) {
    if (DEBUG_RUNTIME) {
      NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
      NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
      NSLog(@"[ZynthJS] callGlobal error for %@: %@", name, message);
      if (stack.length > 0) {
        NSLog(@"[ZynthJS] stack: %@", stack);
      }
    }
    return nil;
  } catch (const std::exception &ex) {
    if (DEBUG_RUNTIME) {
      NSString *message = [NSString stringWithUTF8String:ex.what()];
      NSLog(@"[ZynthJS] callGlobal exception for %@: %@", name, message);
    }
    return nil;
  }
  return nil;
}

@end
