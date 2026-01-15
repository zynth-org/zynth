#ifndef ZYNTH_COMPONENT_API_H
#define ZYNTH_COMPONENT_API_H

#ifdef __OBJC__
#import "SNNode.h"
#import "SNUIManager.h"

NS_ASSUME_NONNULL_BEGIN

/**
 Public surface for component packages that need to interop with the host UI
 manager. These APIs intentionally expose a minimal set of helpers so addons
 do not rely on private headers.
 */
@interface SNUIManager (ZynthComponentAPI)

/// Updates UIKit gesture recognizers and view interaction state after a change.
- (void)zynth_updateInteractionStateForNode:(SNNode *)node;

/// Dispatches an event payload to JavaScript listeners registered on a node.
- (void)zynth_dispatchEvent:(NSString *)name
                  payload:(NSDictionary *_Nullable)payload
                   toNode:(SNNode *)node;

/// Marks that the UI needs to be flushed on the next display link tick.
- (void)zynth_markNeedsFlush;

/// Retrieves a node by its ID. Returns nil if not found.
- (SNNode *_Nullable)zynth_nodeForId:(NSNumber *)nodeId;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* ZYNTH_COMPONENT_API_H */
