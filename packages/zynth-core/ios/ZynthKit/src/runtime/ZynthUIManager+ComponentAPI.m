#import "ZynthComponentAPI.h"
#import "ZynthUIManager+Internal.h"
#import "ZynthUIBindings.h"
#import "ZynthUIManager+Events.h"
#import "ZynthUIManager+Private.h"
#import "ZynthUIManager+Scheduler.h"
#import "ZynthUIManager+Surface.h"

@implementation ZynthUIManager (ZynthComponentAPI)

- (void)zynth_updateInteractionStateForNode:(ZynthNode *)node {
  if (!node) return;
  [self updateInteractionStateForNode:@(node.nid)];
}

- (void)zynth_dispatchEvent:(NSString *)name
                   payload:(NSDictionary *_Nullable)payload
                    toNode:(ZynthNode *)node {
  if (!node || name.length == 0) return;
  ZynthUIInvokeEvent(node.nid, name.UTF8String, payload);
}

- (void)zynth_markNeedsFlush {
  [self requestLayout];
}

- (ZynthNode *)zynth_nodeForId:(NSNumber *)nodeId {
  return [self getNodeState:nodeId];
}

- (void)zynth_storeEventPayload:(NSDictionary *_Nullable)payload
                        forNode:(ZynthNode *)node
                           name:(NSString *)name {
  if (!node || name.length == 0) return;
  NSString *key = [NSString stringWithFormat:@"%d:%@", node.nid, name];
  if (payload) {
    _eventPayloads[key] = payload;
  } else {
    [_eventPayloads removeObjectForKey:key];
  }
}

@end
