#import "ZynthComponentRegistry.h"

#if __has_include(<ZynthKit/ZynthKit-Swift.h>)
#import <ZynthKit/ZynthKit-Swift.h>
#elif __has_include("ZynthKit-Swift.h")
#import "ZynthKit-Swift.h"
#endif

@implementation ZynthComponentDescriptor

- (instancetype)initWithType:(NSString *)type {
  if (self = [super init]) {
    _type = [type copy];
  }
  return self;
}

@end

void ZynthRegisterComponentDescriptor(ZynthComponentDescriptor *descriptor) {
  [[ZynthComponentRegistry shared] register:descriptor];
}

ZynthComponentDescriptor *_Nullable ZynthGetComponentDescriptor(NSString *type) {
  return [[ZynthComponentRegistry shared] getDescriptor:type];
}

NSArray<ZynthComponentDescriptor *> *ZynthAllComponentDescriptors(void) {
  return [[ZynthComponentRegistry shared] allDescriptors];
}
