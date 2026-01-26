#import "ZynthUIBindings.h"
#import "ZynthUIManager.h"

#import <jsi/jsi.h>
#import <dispatch/dispatch.h>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

using namespace facebook::jsi;

static bool DEBUG_RUNTIME = false;

static dispatch_queue_t sJSQueue = nil;
static void *kZynthJSQueueKey = &kZynthJSQueueKey;
static std::mutex sMainOpMutex;
static std::vector<dispatch_block_t> sMainOps;
static BOOL sMainOpsScheduled = NO;

static inline bool ZynthIsOnJSQueue() {
  return sJSQueue && dispatch_get_specific(kZynthJSQueueKey) == kZynthJSQueueKey;
}

void ZynthUISetJSQueue(dispatch_queue_t queue) {
  sJSQueue = queue;
  if (queue) {
    dispatch_queue_set_specific(queue, kZynthJSQueueKey, kZynthJSQueueKey, NULL);
  }
}

static inline void ZynthRunOnMainSync(dispatch_block_t block) {
  if (!block) return;
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

static inline void ZynthRunOnMainAsync(dispatch_block_t block) {
  if (!block) return;
  if ([NSThread isMainThread]) {
    block();
    return;
  }
  dispatch_block_t copied = [block copy];
  BOOL shouldSchedule = NO;
  {
    std::lock_guard<std::mutex> lock(sMainOpMutex);
    sMainOps.push_back(copied);
    if (!sMainOpsScheduled) {
      sMainOpsScheduled = YES;
      shouldSchedule = YES;
    }
  }
  if (!shouldSchedule) {
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    std::vector<dispatch_block_t> pending;
    {
      std::lock_guard<std::mutex> lock(sMainOpMutex);
      pending.swap(sMainOps);
      sMainOpsScheduled = NO;
    }
    for (const auto &op : pending) {
      op();
    }
  });
}

namespace {
struct HandlerKey {
  int nodeId;
  std::string name;

  bool operator==(const HandlerKey &other) const {
    return nodeId == other.nodeId && name == other.name;
  }
};

struct HandlerKeyHash {
  size_t operator()(const HandlerKey &key) const {
    size_t h1 = std::hash<int>()(key.nodeId);
    size_t h2 = std::hash<std::string>()(key.name);
    return h1 ^ (h2 << 1);
  }
};

struct HandlerEntry {
  Runtime *runtime = nullptr;
  std::shared_ptr<Function> handler;
};

static std::unordered_map<HandlerKey, HandlerEntry, HandlerKeyHash> sHandlers;
static std::mutex sHandlersMutex;

static Value ZynthConvertToJSI(Runtime &rt, id value);

static void registerHandler(Runtime &rt, int nodeId, const std::string &name, Function &&fn) {
  std::lock_guard<std::mutex> lock(sHandlersMutex);
  HandlerKey key{nodeId, name};
  sHandlers[key] = HandlerEntry{&rt, std::make_shared<Function>(std::move(fn))};
}

static void removeHandlersForNode(int nodeId) {
  std::lock_guard<std::mutex> lock(sHandlersMutex);
  for (auto it = sHandlers.begin(); it != sHandlers.end();) {
    if (it->first.nodeId == nodeId) {
      it = sHandlers.erase(it);
    } else {
      ++it;
    }
  }
}

static NSString *ZynthStringifyStyleValue(Runtime &rt, const Value &value) {
  if (value.isString()) {
    std::string str = value.asString(rt).utf8(rt);
    return [NSString stringWithUTF8String:str.c_str()];
  }
  if (!value.isObject()) return nil;
  try {
    Object json = rt.global().getPropertyAsObject(rt, "JSON");
    Function stringify = json.getPropertyAsFunction(rt, "stringify");
    Value result = stringify.call(rt, value);
    if (result.isString()) {
      std::string str = result.asString(rt).utf8(rt);
      return [NSString stringWithUTF8String:str.c_str()];
    }
  } catch (...) {
    return nil;
  }
  return nil;
}

static Value ZynthConvertToJSI(Runtime &rt, id value) {
  if (!value || value == (id)kCFNull) {
    return Value::null();
  }
  if ([value isKindOfClass:[NSString class]]) {
    NSString *str = (NSString *)value;
    return Value(String::createFromUtf8(rt, str.UTF8String));
  }
  if ([value isKindOfClass:[NSNumber class]]) {
    NSNumber *num = (NSNumber *)value;
    if (CFGetTypeID((__bridge CFTypeRef)num) == CFBooleanGetTypeID()) {
      return Value((bool)num.boolValue);
    }
    return Value((double)num.doubleValue);
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSArray *array = (NSArray *)value;
    Array jsArray(rt, array.count);
    for (NSUInteger i = 0; i < array.count; i++) {
      jsArray.setValueAtIndex(rt, i, ZynthConvertToJSI(rt, array[i]));
    }
    return Value(std::move(jsArray));
  }
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)value;
    Object obj(rt);
    for (id key in dict) {
      if (![key isKindOfClass:[NSString class]]) continue;
      NSString *keyString = (NSString *)key;
      obj.setProperty(rt, keyString.UTF8String, ZynthConvertToJSI(rt, dict[key]));
    }
    return Value(std::move(obj));
  }
  return Value::undefined();
}
} // namespace

extern "C" void ZynthUIInvokePressEvent(int nodeId,
                                        const char *name,
                                        double x,
                                        double y,
                                        double screenX,
                                        double screenY,
                                        double durationMs,
                                        double timestampMs,
                                        bool cancelled) {
  std::string eventName = name ? name : "";
  if (eventName.empty()) return;
  Runtime *runtime = nullptr;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(sHandlersMutex);
    HandlerKey key{nodeId, eventName};
    auto it = sHandlers.find(key);
    if (it == sHandlers.end()) return;
    runtime = it->second.runtime;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  auto invoke = ^{
    Object payload(rt);
    payload.setProperty(rt, "x", x);
    payload.setProperty(rt, "y", y);
    payload.setProperty(rt, "screenX", screenX);
    payload.setProperty(rt, "screenY", screenY);
    if (durationMs >= 0) {
      payload.setProperty(rt, "durationMs", durationMs);
    }
    payload.setProperty(rt, "timestamp", timestampMs);
    payload.setProperty(rt, "pointerType", String::createFromUtf8(rt, "touch"));
    payload.setProperty(rt, "canceled", cancelled);
    try {
      handler->call(rt, payload);
    } catch (const JSError &error) {
      if (DEBUG_RUNTIME) {
        NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
        NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
        NSLog(@"[ZynthUI] press handler error for %d/%s: %@", nodeId, eventName.c_str(), message);
        if (stack.length > 0) {
          NSLog(@"[ZynthUI] stack: %@", stack);
        }
      }
    } catch (const std::exception &ex) {
      if (DEBUG_RUNTIME) {
        NSString *message = [NSString stringWithUTF8String:ex.what()];
        NSLog(@"[ZynthUI] press handler exception for %d/%s: %@", nodeId, eventName.c_str(), message);
      }
    }
  };

  if (sJSQueue && !ZynthIsOnJSQueue()) {
    dispatch_async(sJSQueue, invoke);
  } else {
    invoke();
  }
}

extern "C" void ZynthUIInvokeLayoutEvent(int nodeId,
                                         double x,
                                         double y,
                                         double width,
                                         double height) {
  std::string eventName = "onLayout";
  Runtime *runtime = nullptr;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(sHandlersMutex);
    HandlerKey key{nodeId, eventName};
    auto it = sHandlers.find(key);
    if (it == sHandlers.end()) return;
    runtime = it->second.runtime;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  auto invoke = ^{
    Object payload(rt);
    Object nativeEvent(rt);
    Object layout(rt);
    layout.setProperty(rt, "x", x);
    layout.setProperty(rt, "y", y);
    layout.setProperty(rt, "width", width);
    layout.setProperty(rt, "height", height);
    nativeEvent.setProperty(rt, "layout", layout);
    payload.setProperty(rt, "nativeEvent", nativeEvent);
    try {
      handler->call(rt, payload);
    } catch (const JSError &error) {
      if (DEBUG_RUNTIME) {
        NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
        NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
        NSLog(@"[ZynthUI] layout handler error for %d: %@", nodeId, message);
        if (stack.length > 0) {
          NSLog(@"[ZynthUI] stack: %@", stack);
        }
      }
    } catch (const std::exception &ex) {
      if (DEBUG_RUNTIME) {
        NSString *message = [NSString stringWithUTF8String:ex.what()];
        NSLog(@"[ZynthUI] layout handler exception for %d: %@", nodeId, message);
      }
    }
  };

  if (sJSQueue && !ZynthIsOnJSQueue()) {
    dispatch_async(sJSQueue, invoke);
  } else {
    invoke();
  }
}

extern "C" void ZynthUIInvokeEvent(int nodeId, const char *name, NSDictionary *payload) {
  std::string eventName = name ? name : "";
  if (eventName.empty()) return;
  Runtime *runtime = nullptr;
  std::shared_ptr<Function> handler;
  {
    std::lock_guard<std::mutex> lock(sHandlersMutex);
    HandlerKey key{nodeId, eventName};
    auto it = sHandlers.find(key);
    if (it == sHandlers.end()) return;
    runtime = it->second.runtime;
    handler = it->second.handler;
  }
  if (!runtime || !handler) return;
  Runtime &rt = *runtime;
  NSDictionary *payloadCopy = payload;
  auto invoke = ^{
    Value payloadValue = ZynthConvertToJSI(rt, payloadCopy);
    try {
      if (payloadValue.isUndefined() || payloadValue.isNull()) {
        handler->call(rt);
      } else {
        handler->call(rt, payloadValue);
      }
    } catch (const JSError &error) {
      if (DEBUG_RUNTIME) {
        NSString *message = [NSString stringWithUTF8String:error.getMessage().c_str()];
        NSString *stack = [NSString stringWithUTF8String:error.getStack().c_str()];
        NSLog(@"[ZynthUI] handler error for %d/%s: %@", nodeId, eventName.c_str(), message);
        if (stack.length > 0) {
          NSLog(@"[ZynthUI] stack: %@", stack);
        }
      }
    } catch (const std::exception &ex) {
      if (DEBUG_RUNTIME) {
        NSString *message = [NSString stringWithUTF8String:ex.what()];
        NSLog(@"[ZynthUI] handler exception for %d/%s: %@", nodeId, eventName.c_str(), message);
      }
    }
  };

  if (sJSQueue && !ZynthIsOnJSQueue()) {
    dispatch_async(sJSQueue, invoke);
  } else {
    invoke();
  }
}

static void ZynthApplyStyleObject(Runtime &rt, ZynthUIManager *manager, int nodeId, const Object &style) {
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

  for (const char *key : numericKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    if (v.isNumber()) {
      std::string str = std::to_string(v.asNumber());
      NSString *name = [NSString stringWithUTF8String:key];
      NSString *value = [NSString stringWithUTF8String:str.c_str()];
      ZynthRunOnMainAsync(^{
        [manager setProp:@(nodeId) name:name value:value];
      });
    } else if (v.isString()) {
      std::string str = v.asString(rt).utf8(rt);
      NSString *name = [NSString stringWithUTF8String:key];
      NSString *value = [NSString stringWithUTF8String:str.c_str()];
      ZynthRunOnMainAsync(^{
        [manager setProp:@(nodeId) name:name value:value];
      });
    }
  }

  for (const char *key : stringKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    if (v.isString()) {
      std::string str = v.asString(rt).utf8(rt);
      NSString *name = [NSString stringWithUTF8String:key];
      NSString *value = [NSString stringWithUTF8String:str.c_str()];
      ZynthRunOnMainAsync(^{
        [manager setProp:@(nodeId) name:name value:value];
      });
    }
  }

  for (const char *key : objectKeys) {
    if (!style.hasProperty(rt, key)) continue;
    Value v = style.getProperty(rt, key);
    NSString *value = ZynthStringifyStyleValue(rt, v);
    if (!value) continue;
    NSString *name = [NSString stringWithUTF8String:key];
    ZynthRunOnMainAsync(^{
      [manager setProp:@(nodeId) name:name value:value];
    });
  }
}

void ZynthInstallUIBindings(Runtime &rt, ZynthUIManager *manager) {
  if (!manager) return;

  Object ui(rt);

  auto createNode = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "createNode"), 1,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isString()) {
          return Value::undefined();
        }
        std::string type = args[0].asString(rt).utf8(rt);
        NSString *typeName = [NSString stringWithUTF8String:type.c_str()];
        __block NSNumber *nodeId = nil;
        ZynthRunOnMainSync(^{
          nodeId = [manager createNode:typeName];
        });
        if (!nodeId) {
          return Value::undefined();
        }
        if (DEBUG_RUNTIME) {
          NSLog(@"[ZynthUI] createNode id=%d type=%s", nodeId.intValue, type.c_str());
        }
        return Value((double)nodeId.intValue);
      });

  auto setProp = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setProp"), 3,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        int nodeId = (int)args[0].asNumber();
        std::string name = args[1].asString(rt).utf8(rt);
        if (name == "style" && args[2].isObject()) {
          ZynthApplyStyleObject(rt, manager, nodeId, args[2].asObject(rt));
          return Value::undefined();
        }
        std::string value;
        if (args[2].isString()) {
          value = args[2].asString(rt).utf8(rt);
        } else if (args[2].isNumber()) {
          value = std::to_string(args[2].asNumber());
        } else if (args[2].isBool()) {
          value = args[2].getBool() ? "true" : "false";
        }
        if (!value.empty()) {
          NSString *propName = [NSString stringWithUTF8String:name.c_str()];
          NSString *propValue = [NSString stringWithUTF8String:value.c_str()];
          ZynthRunOnMainAsync(^{
            [manager setProp:@(nodeId) name:propName value:propValue];
          });
          if (DEBUG_RUNTIME) {
            NSLog(@"[ZynthUI] setProp id=%d name=%s value=%s", nodeId, name.c_str(), value.c_str());
          }
        }
        return Value::undefined();
      });

  auto setText = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setText"), 2,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int nodeId = (int)args[0].asNumber();
        std::string text = args[1].isString() ? args[1].asString(rt).utf8(rt) : "";
        NSString *textValue = [NSString stringWithUTF8String:text.c_str()];
        ZynthRunOnMainAsync(^{
          [manager setText:@(nodeId) text:textValue];
        });
        if (DEBUG_RUNTIME) {
          NSLog(@"[ZynthUI] setText id=%d text=%s", nodeId, text.c_str());
        }
        return Value::undefined();
      });

  auto insertChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "insertChild"), 3,
      [manager](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 3 || !args[0].isNumber() || !args[1].isNumber() || !args[2].isNumber()) {
          return Value::undefined();
        }
        int parentId = (int)args[0].asNumber();
        int childId = (int)args[1].asNumber();
        int index = (int)args[2].asNumber();
        ZynthRunOnMainAsync(^{
          [manager insertChild:@(parentId) child:@(childId) index:@(index)];
        });
        if (DEBUG_RUNTIME) {
          NSLog(@"[ZynthUI] insertChild parent=%d child=%d index=%d",
                parentId,
                childId,
                index);
        }
        return Value::undefined();
      });

  auto removeChild = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "removeChild"), 2,
      [manager](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isNumber()) {
          return Value::undefined();
        }
        int parentId = (int)args[0].asNumber();
        int childId = (int)args[1].asNumber();
        removeHandlersForNode(childId);
        ZynthRunOnMainAsync(^{
          [manager removeChild:@(parentId) child:@(childId)];
        });
        if (DEBUG_RUNTIME) {
          NSLog(@"[ZynthUI] removeChild parent=%d child=%d",
                parentId,
                childId);
        }
        return Value::undefined();
      });

  auto setHandler = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setHandler"), 3,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 2 || !args[0].isNumber() || !args[1].isString()) {
          return Value::undefined();
        }
        int nodeId = (int)args[0].asNumber();
        std::string name = args[1].asString(rt).utf8(rt);
        if (count >= 3 && args[2].isObject() && args[2].asObject(rt).isFunction(rt)) {
          Function fn = args[2].asObject(rt).asFunction(rt);
          registerHandler(rt, nodeId, name, std::move(fn));
        }
        NSString *handlerName = [NSString stringWithUTF8String:name.c_str()];
        ZynthRunOnMainAsync(^{
          [manager setHandler:@(nodeId) name:handlerName];
        });
        return Value::undefined();
      });

  auto applyBatch = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatch"), 1,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1) return Value::undefined();
        if (DEBUG_RUNTIME) {
          NSLog(@"[ZynthUI] applyBatch invoked");
        }
        std::string json = args[0].isString() ? args[0].asString(rt).utf8(rt) : "";
        NSString *payload = [NSString stringWithUTF8String:json.c_str()];
        ZynthRunOnMainAsync(^{
          [manager applyBatch:payload];
        });
        return Value::undefined();
      });

  struct ZynthBatchOp {
    enum class Kind {
      CreateNode,
      SetProp,
      SetText,
      InsertChild,
      RemoveChild,
    };
    Kind kind = Kind::SetProp;
    int nodeId = 0;
    int parentId = 0;
    int childId = 0;
    int index = 0;
    std::string name;
    std::string value;
    bool hasValue = false;
    std::string tag;
  };

  auto applyBatchTyped = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "applyBatchTyped"), 1,
      [manager](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isObject()) return Value::undefined();
        Object payload = args[0].asObject(rt);
        Value opsPackedVal = payload.getProperty(rt, "ops");
        Value stringTableVal = payload.getProperty(rt, "stringTable");
        if (opsPackedVal.isObject() && stringTableVal.isObject()) {
          Array opsPacked = opsPackedVal.asObject(rt).asArray(rt);
          Array stringTable = stringTableVal.asObject(rt).asArray(rt);
          const size_t stringCount = stringTable.length(rt);
          std::vector<std::string> strings;
          strings.reserve(stringCount);
          for (size_t i = 0; i < stringCount; i++) {
            Value entry = stringTable.getValueAtIndex(rt, i);
            if (entry.isString()) {
              strings.push_back(entry.asString(rt).utf8(rt));
            } else {
              strings.emplace_back();
            }
          }
          const size_t opCount = opsPacked.length(rt);
          size_t i = 0;
          auto getString = [&strings](size_t index) -> const std::string & {
            static const std::string empty;
            if (index >= strings.size()) return empty;
            return strings[index];
          };
          std::vector<ZynthBatchOp> ops;
          while (i < opCount) {
            Value opVal = opsPacked.getValueAtIndex(rt, i++);
            if (!opVal.isNumber()) break;
            int opcode = static_cast<int>(opVal.asNumber());
            switch (opcode) {
              case 1: { // setProp
                if (i + 3 >= opCount) { i = opCount; break; }
                int nodeId = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                int keyIndex = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                int valueType = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                double payloadVal = opsPacked.getValueAtIndex(rt, i++).asNumber();
                const std::string &key = getString(static_cast<size_t>(keyIndex));
                switch (valueType) {
                  case 1: {
                    ZynthBatchOp op;
                    op.kind = ZynthBatchOp::Kind::SetProp;
                    op.nodeId = nodeId;
                    op.name = key;
                    op.value = std::to_string(payloadVal);
                    op.hasValue = true;
                    ops.push_back(op);
                    break;
                  }
                  case 2: {
                    ZynthBatchOp op;
                    op.kind = ZynthBatchOp::Kind::SetProp;
                    op.nodeId = nodeId;
                    op.name = key;
                    op.value = getString(static_cast<size_t>(payloadVal));
                    op.hasValue = true;
                    ops.push_back(op);
                    break;
                  }
                  case 3: {
                    ZynthBatchOp op;
                    op.kind = ZynthBatchOp::Kind::SetProp;
                    op.nodeId = nodeId;
                    op.name = key;
                    op.value = payloadVal != 0 ? "true" : "false";
                    op.hasValue = true;
                    ops.push_back(op);
                    break;
                  }
                  case 0:
                  default: {
                    ZynthBatchOp op;
                    op.kind = ZynthBatchOp::Kind::SetProp;
                    op.nodeId = nodeId;
                    op.name = key;
                    op.hasValue = false;
                    ops.push_back(op);
                    break;
                  }
                }
                break;
              }
              case 2: { // setText
                if (i + 1 >= opCount) { i = opCount; break; }
                int nodeId = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                int textIndex = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                ZynthBatchOp op;
                op.kind = ZynthBatchOp::Kind::SetText;
                op.nodeId = nodeId;
                op.value = getString(static_cast<size_t>(textIndex));
                ops.push_back(op);
                break;
              }
              case 3: { // insertChild
                if (i + 2 >= opCount) { i = opCount; break; }
                int parentId = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                int childId = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                int index = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                ZynthBatchOp op;
                op.kind = ZynthBatchOp::Kind::InsertChild;
                op.parentId = parentId;
                op.childId = childId;
                op.index = index;
                ops.push_back(op);
                break;
              }
              case 4: { // removeChild
                if (i + 1 >= opCount) { i = opCount; break; }
                int parentId = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                int childId = static_cast<int>(opsPacked.getValueAtIndex(rt, i++).asNumber());
                ZynthBatchOp op;
                op.kind = ZynthBatchOp::Kind::RemoveChild;
                op.parentId = parentId;
                op.childId = childId;
                ops.push_back(op);
                break;
              }
              default:
                i = opCount;
                break;
            }
          }
          if (!ops.empty()) {
            ZynthRunOnMainAsync(^{
              for (const auto &op : ops) {
                switch (op.kind) {
                  case ZynthBatchOp::Kind::SetProp: {
                    NSString *name = [NSString stringWithUTF8String:op.name.c_str()];
                    NSString *value = op.hasValue ? [NSString stringWithUTF8String:op.value.c_str()] : nil;
                    [manager setProp:@(op.nodeId) name:name value:value];
                    break;
                  }
                  case ZynthBatchOp::Kind::SetText: {
                    NSString *text = [NSString stringWithUTF8String:op.value.c_str()];
                    [manager setText:@(op.nodeId) text:text];
                    break;
                  }
                  case ZynthBatchOp::Kind::InsertChild:
                    [manager insertChild:@(op.parentId) child:@(op.childId) index:@(op.index)];
                    break;
                  case ZynthBatchOp::Kind::RemoveChild:
                    removeHandlersForNode(op.childId);
                    [manager removeChild:@(op.parentId) child:@(op.childId)];
                    break;
                  case ZynthBatchOp::Kind::CreateNode:
                    break;
                }
              }
            });
          }
          return Value::undefined();
        }
        Value opsVal = payload.getProperty(rt, "operations");
        if (!opsVal.isObject()) return Value::undefined();
        Array ops = opsVal.asObject(rt).asArray(rt);
        const size_t opCount = ops.length(rt);
        if (DEBUG_RUNTIME) {
          NSLog(@"[ZynthUI] applyBatchTyped ops=%zu", opCount);
        }
        size_t loggedOps = 0;
        std::vector<ZynthBatchOp> operations;
        for (size_t i = 0; i < opCount; i++) {
          Value opVal = ops.getValueAtIndex(rt, i);
          if (!opVal.isObject()) continue;
          Object op = opVal.asObject(rt);
          Value typeVal = op.getProperty(rt, "type");
          if (!typeVal.isString()) continue;
          std::string type = typeVal.asString(rt).utf8(rt);
          if (DEBUG_RUNTIME && loggedOps < 10) {
            NSLog(@"[ZynthUI] op[%zu]=%s", i, type.c_str());
            loggedOps++;
          }
          if (type == "createNode") {
            Value idVal = op.getProperty(rt, "nodeId");
            Value tagVal = op.getProperty(rt, "tag");
            if (!tagVal.isString()) continue;
            std::string tag = tagVal.asString(rt).utf8(rt);
            ZynthBatchOp opEntry;
            opEntry.kind = ZynthBatchOp::Kind::CreateNode;
            opEntry.nodeId = idVal.isNumber() ? (int)idVal.asNumber() : 0;
            opEntry.tag = tag;
            operations.push_back(opEntry);
            continue;
          }
          if (type == "setProp") {
            Value idVal = op.getProperty(rt, "nodeId");
            Value nameVal = op.getProperty(rt, "name");
            Value valueVal = op.getProperty(rt, "value");
            if (!idVal.isNumber() || !nameVal.isString()) continue;
            int nodeId = (int)idVal.asNumber();
            std::string name = nameVal.asString(rt).utf8(rt);
            if (name == "style" && valueVal.isObject()) {
              ZynthApplyStyleObject(rt, manager, nodeId, valueVal.asObject(rt));
              continue;
            }
            std::string value;
            if (valueVal.isString()) {
              value = valueVal.asString(rt).utf8(rt);
            } else if (valueVal.isNumber()) {
              value = std::to_string(valueVal.asNumber());
            } else if (valueVal.isBool()) {
              value = valueVal.getBool() ? "true" : "false";
            }
            if (!value.empty()) {
              ZynthBatchOp opEntry;
              opEntry.kind = ZynthBatchOp::Kind::SetProp;
              opEntry.nodeId = nodeId;
              opEntry.name = name;
              opEntry.value = value;
              opEntry.hasValue = true;
              operations.push_back(opEntry);
            }
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
            ZynthBatchOp opEntry;
            opEntry.kind = ZynthBatchOp::Kind::SetText;
            opEntry.nodeId = (int)idVal.asNumber();
            opEntry.value = text;
            operations.push_back(opEntry);
            continue;
          }
          if (type == "insertChild") {
            Value parentVal = op.getProperty(rt, "parentId");
            Value childVal = op.getProperty(rt, "childId");
            Value indexVal = op.getProperty(rt, "index");
            if (!parentVal.isNumber() || !childVal.isNumber() || !indexVal.isNumber()) continue;
            ZynthBatchOp opEntry;
            opEntry.kind = ZynthBatchOp::Kind::InsertChild;
            opEntry.parentId = (int)parentVal.asNumber();
            opEntry.childId = (int)childVal.asNumber();
            opEntry.index = (int)indexVal.asNumber();
            operations.push_back(opEntry);
            continue;
          }
          if (type == "removeChild") {
            Value parentVal = op.getProperty(rt, "parentId");
            Value childVal = op.getProperty(rt, "childId");
            if (!parentVal.isNumber() || !childVal.isNumber()) continue;
            ZynthBatchOp opEntry;
            opEntry.kind = ZynthBatchOp::Kind::RemoveChild;
            opEntry.parentId = (int)parentVal.asNumber();
            opEntry.childId = (int)childVal.asNumber();
            operations.push_back(opEntry);
            continue;
          }
        }
        if (!operations.empty()) {
          ZynthRunOnMainAsync(^{
            for (const auto &op : operations) {
              switch (op.kind) {
                case ZynthBatchOp::Kind::CreateNode: {
                  NSString *tag = [NSString stringWithUTF8String:op.tag.c_str()];
                  NSNumber *nodeId = [manager createNode:tag];
                  if (DEBUG_RUNTIME && op.nodeId != 0) {
                    if (nodeId.intValue != op.nodeId) {
                      NSLog(@"[ZynthUI] createNode id mismatch expected=%d actual=%d",
                            op.nodeId, nodeId.intValue);
                    }
                  }
                  if (DEBUG_RUNTIME) {
                    NSLog(@"[ZynthUI] createNode id=%d type=%s (batch)", nodeId.intValue, op.tag.c_str());
                  }
                  break;
                }
                case ZynthBatchOp::Kind::SetProp: {
                  NSString *name = [NSString stringWithUTF8String:op.name.c_str()];
                  NSString *value = op.hasValue ? [NSString stringWithUTF8String:op.value.c_str()] : nil;
                  [manager setProp:@(op.nodeId) name:name value:value];
                  if (DEBUG_RUNTIME) {
                    NSLog(@"[ZynthUI] setProp id=%d name=%s value=%s", op.nodeId, op.name.c_str(), op.value.c_str());
                  }
                  break;
                }
                case ZynthBatchOp::Kind::SetText: {
                  NSString *text = [NSString stringWithUTF8String:op.value.c_str()];
                  [manager setText:@(op.nodeId) text:text];
                  if (DEBUG_RUNTIME) {
                    NSLog(@"[ZynthUI] setText id=%d text=%s", op.nodeId, op.value.c_str());
                  }
                  break;
                }
                case ZynthBatchOp::Kind::InsertChild:
                  [manager insertChild:@(op.parentId) child:@(op.childId) index:@(op.index)];
                  if (DEBUG_RUNTIME) {
                    NSLog(@"[ZynthUI] insertChild parent=%d child=%d index=%d",
                          op.parentId, op.childId, op.index);
                  }
                  break;
                case ZynthBatchOp::Kind::RemoveChild:
                  removeHandlersForNode(op.childId);
                  [manager removeChild:@(op.parentId) child:@(op.childId)];
                  if (DEBUG_RUNTIME) {
                    NSLog(@"[ZynthUI] removeChild parent=%d child=%d",
                          op.parentId, op.childId);
                  }
                  break;
              }
            }
          });
        }
        return Value::undefined();
      });

  auto setSurface = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "setSurface"), 1,
      [manager](Runtime &, const Value &, const Value *args, size_t count) -> Value {
        if (count < 1 || !args[0].isNumber()) {
          return Value::undefined();
        }
        int surfaceId = (int)args[0].asNumber();
        ZynthRunOnMainAsync(^{
          [manager setSurface:@(surfaceId)];
        });
        return Value::undefined();
      });

  auto flush = Function::createFromHostFunction(
      rt, PropNameID::forAscii(rt, "flush"), 0,
      [manager](Runtime &, const Value &, const Value *, size_t) -> Value {
        ZynthRunOnMainAsync(^{
          [manager flush];
        });
        return Value::undefined();
      });

  ui.setProperty(rt, "createNode", createNode);
  ui.setProperty(rt, "setProp", setProp);
  ui.setProperty(rt, "setText", setText);
  ui.setProperty(rt, "insertChild", insertChild);
  ui.setProperty(rt, "removeChild", removeChild);
  ui.setProperty(rt, "setHandler", setHandler);
  ui.setProperty(rt, "applyBatch", applyBatch);
  ui.setProperty(rt, "applyBatchTyped", applyBatchTyped);
  ui.setProperty(rt, "setSurface", setSurface);
  ui.setProperty(rt, "flush", flush);
  ui.setProperty(rt, "__supportsTypedProps", true);
  ui.setProperty(rt, "__supportsTypedBatch", true);

  rt.global().setProperty(rt, "__ui", std::move(ui));
}
