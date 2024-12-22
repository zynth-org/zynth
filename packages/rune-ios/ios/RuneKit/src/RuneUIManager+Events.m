#import "RuneUIManager+Events.h"

@implementation SNUIManager (RuneEvents)

- (NSString *_Nullable)rune_eventKeyForNode:(int)nodeId name:(NSString *)name {
  if (nodeId <= 0 || name.length == 0) return nil;
  return [NSString stringWithFormat:@"%d::%@", nodeId, name];
}

- (void)rune_storeEventPayload:(NSDictionary *_Nullable)payload
                       forNode:(SNNode *)node
                          name:(NSString *)name {
  if (!node || name.length == 0) return;
  NSString *key = [self rune_eventKeyForNode:node.nid name:name];
  if (!key) return;

  if (payload && payload.count > 0) {
    if (!self.eventPayloads) {
      [self rune_setEventPayloads:[NSMutableDictionary new]];
    }
    [self.eventPayloads setObject:payload forKey:key];
  } else {
    [self.eventPayloads removeObjectForKey:key];
  }
}

- (NSDictionary *)rune_dequeueEventPayloadForNode:(int)nodeId
                                             name:(NSString *)name {
  NSString *key = [self rune_eventKeyForNode:nodeId name:name];
  if (!key || key.length == 0) {
    return @{};
  }

  NSDictionary *payload = self.eventPayloads[key];
  if (payload) {
    [self.eventPayloads removeObjectForKey:key];
    return payload;
  }
  return @{};
}

- (void)rune_dispatchEvent:(NSString *)name
                   payload:(NSDictionary *_Nullable)payload
                    toNode:(SNNode *)node {
  if (!node || name.length == 0) return;

  NSDictionary *normalized = payload ?: @{};
  BOOL invoked = NO;

  if (self.jsInvoker && (([name isEqualToString:@"onLoad"] && node.hasOnLoadHandler) ||
                         ([name isEqualToString:@"onError"] && node.hasOnErrorHandler))) {
    if (normalized.count > 0) {
      [self rune_storeEventPayload:normalized forNode:node name:name];
    } else {
      [self rune_storeEventPayload:nil forNode:node name:name];
    }
    [self.jsInvoker invokeHandlerForNode:node.nid name:name];
    invoked = YES;
  }

  if (invoked) return;

  JSValue *callback = nil;
  if ([name isEqualToString:@"onLoad"]) {
    callback = node.onLoadCallback;
  } else if ([name isEqualToString:@"onError"]) {
    callback = node.onErrorCallback;
  }

  if (!callback || [callback isUndefined] || [callback isNull]) {
    return;
  }

  if (normalized.count > 0) {
    [callback callWithArguments:@[normalized]];
  } else {
    [callback callWithArguments:@[]];
  }
}

@end
