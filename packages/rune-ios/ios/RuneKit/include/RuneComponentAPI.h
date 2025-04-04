#ifndef RUNE_COMPONENT_API_H
#define RUNE_COMPONENT_API_H

#ifdef __OBJC__
#import "SNNode.h"
#import "SNUIManager.h"

NS_ASSUME_NONNULL_BEGIN

/**
 Public surface for component packages that need to interop with the host UI
 manager. These APIs intentionally expose a minimal set of helpers so addons
 do not rely on private headers.
 */
@interface SNUIManager (RuneComponentAPI)

/// Updates UIKit gesture recognizers and view interaction state after a change.
- (void)rune_updateInteractionStateForNode:(SNNode *)node;

/// Dispatches an event payload to JavaScript listeners registered on a node.
- (void)rune_dispatchEvent:(NSString *)name
                  payload:(NSDictionary *_Nullable)payload
                   toNode:(SNNode *)node;

/// Marks that the UI needs to be flushed on the next display link tick.
- (void)rune_markNeedsFlush;

/// Retrieves a node by its ID. Returns nil if not found.
- (SNNode *_Nullable)rune_nodeForId:(NSNumber *)nodeId;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* RUNE_COMPONENT_API_H */
