#ifndef ZYNTH_COMPONENT_API_H
#define ZYNTH_COMPONENT_API_H

#ifdef __OBJC__
#import "ZynthNode.h"
#import "ZynthUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (ZynthComponentAPI)

- (void)zynth_updateInteractionStateForNode:(ZynthNode *)node;
- (void)zynth_dispatchEvent:(NSString *)name
                   payload:(NSDictionary *_Nullable)payload
                    toNode:(ZynthNode *)node;
- (void)zynth_markNeedsFlush;
- (ZynthNode *_Nullable)zynth_nodeForId:(NSNumber *)nodeId NS_SWIFT_NAME(zynth_node(forId:));
- (void)zynth_storeEventPayload:(NSDictionary *_Nullable)payload
                        forNode:(ZynthNode *)node
                           name:(NSString *)name;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* ZYNTH_COMPONENT_API_H */
