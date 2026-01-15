#import <Foundation/Foundation.h>

#import "SNUIManager+Internal.h"

NS_ASSUME_NONNULL_BEGIN

@interface SNUIManager (ZynthEvents)

- (NSString *_Nullable)zynth_eventKeyForNode:(int)nodeId name:(NSString *)name;
- (void)zynth_storeEventPayload:(NSDictionary *_Nullable)payload
                       forNode:(SNNode *)node
                          name:(NSString *)name;
- (NSDictionary *_Nullable)zynth_dequeueEventPayloadForNode:(int)nodeId
                                             name:(NSString *)name;
- (void)zynth_dispatchEvent:(NSString *)name
                   payload:(NSDictionary *_Nullable)payload
                    toNode:(SNNode *)node;

@end

NS_ASSUME_NONNULL_END

