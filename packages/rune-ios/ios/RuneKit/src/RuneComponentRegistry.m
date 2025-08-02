#import "RuneComponentRegistry.h"

#if __has_include(<RuneKit/RuneKit-Swift.h>)
#import <RuneKit/RuneKit-Swift.h>
#elif __has_include("RuneKit-Swift.h")
#import "RuneKit-Swift.h"
#endif

@implementation RuneComponentDescriptor

- (instancetype)initWithType:(NSString *)type {
  if (self = [super init]) {
    _type = [type copy];
  }
  return self;
}

@end

void RuneRegisterComponentDescriptor(RuneComponentDescriptor *descriptor) {
  [[RuneComponentRegistry shared] register:descriptor];
}

RuneComponentDescriptor *_Nullable RuneGetComponentDescriptor(NSString *type) {
  return [[RuneComponentRegistry shared] getDescriptor:type];
}

NSArray<RuneComponentDescriptor *> *RuneAllComponentDescriptors(void) {
  return [[RuneComponentRegistry shared] allDescriptors];
}
