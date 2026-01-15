#import "ZynthUIManager+Events.h"

@implementation SNUIManager (ZynthEvents)

- (NSString *_Nullable)zynth_eventKeyForNode:(int)nodeId name:(NSString *)name {
  if (nodeId <= 0 || name.length == 0) return nil;
  return [NSString stringWithFormat:@"%d::%@", nodeId, name];
}

- (void)zynth_storeEventPayload:(NSDictionary *_Nullable)payload
                       forNode:(SNNode *)node
                          name:(NSString *)name {
  if (!node || name.length == 0) return;
  NSString *key = [self zynth_eventKeyForNode:node.nid name:name];
  if (!key) return;

  if (payload && payload.count > 0) {
    if (!self.eventPayloads) {
      [self zynth_setEventPayloads:[NSMutableDictionary new]];
    }
    [self.eventPayloads setObject:payload forKey:key];
  } else {
    [self.eventPayloads removeObjectForKey:key];
  }
}

- (NSDictionary *)zynth_dequeueEventPayloadForNode:(int)nodeId
                                             name:(NSString *)name {
  NSString *key = [self zynth_eventKeyForNode:nodeId name:name];
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

- (void)zynth_dispatchEvent:(NSString *)name
                   payload:(NSDictionary *_Nullable)payload
                    toNode:(SNNode *)node {
  if (!node || name.length == 0) return;

  NSDictionary *normalized = payload ?: @{};
  if (self.jsInvoker) {
    if (normalized.count > 0) {
      [self zynth_storeEventPayload:normalized forNode:node name:name];
    } else {
      [self zynth_storeEventPayload:nil forNode:node name:name];
    }
    [self.jsInvoker invokeHandlerForNode:node.nid name:name];
    return;
  }
}

@end
