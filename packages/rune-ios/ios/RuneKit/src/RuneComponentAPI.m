#import "RuneComponentAPI.h"
#import "SNUIManager+Internal.h"

@implementation SNUIManager (RuneComponentAPI)

- (SNNode *)rune_nodeForId:(NSNumber *)nodeId {
  return [self.nodes objectForKey:nodeId];
}

@end
