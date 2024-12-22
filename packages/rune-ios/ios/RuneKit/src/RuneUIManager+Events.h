#import <Foundation/Foundation.h>

#import "SNUIManager+Internal.h"

@interface SNUIManager (RuneEvents)

- (NSString *_Nullable)rune_eventKeyForNode:(int)nodeId name:(NSString *)name;
- (void)rune_storeEventPayload:(NSDictionary *_Nullable)payload
                       forNode:(SNNode *)node
                          name:(NSString *)name;
- (NSDictionary *)rune_dequeueEventPayloadForNode:(int)nodeId
                                             name:(NSString *)name;
- (void)rune_dispatchEvent:(NSString *)name
                   payload:(NSDictionary *_Nullable)payload
                    toNode:(SNNode *)node;

@end

