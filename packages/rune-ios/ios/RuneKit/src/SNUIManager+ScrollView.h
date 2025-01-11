#import "SNUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@class SNNode;

@interface SNUIManager (ScrollView)

- (void)sn_scrollViewAttachIfNeeded:(SNNode *)node;
- (BOOL)sn_scrollViewHandlesSetPropForNode:(SNNode *)node
                                      name:(NSString *)name
                                     value:(id)value
                                    rawJSON:(NSString *)rawJSON;
- (BOOL)sn_scrollViewHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name;
- (void)sn_scrollViewCleanupNode:(SNNode *)node;
- (BOOL)sn_scrollViewDidInsertChild:(SNNode *)parent
                              child:(SNNode *)child
                            atIndex:(NSInteger)index;
- (BOOL)sn_scrollViewDidRemoveChild:(SNNode *)parent child:(SNNode *)child;

@end

NS_ASSUME_NONNULL_END
