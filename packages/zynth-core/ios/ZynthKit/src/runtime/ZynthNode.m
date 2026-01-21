#import "ZynthNode.h"

@implementation ZynthNode

- (instancetype)init {
  self = [super init];
  if (self) {
    _children = [NSMutableArray array];
    _attachments = [NSMutableDictionary dictionary];
    _pointerEvents = @"auto";
  }
  return self;
}

@end
