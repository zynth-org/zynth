#import "ZynthComponentAPI.h"
#import "SNUIManager+Internal.h"

@implementation SNUIManager (ZynthComponentAPI)

- (SNNode *)zynth_nodeForId:(NSNumber *)nodeId {
  return [self.nodes objectForKey:nodeId];
}

@end
