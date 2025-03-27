#import "RuneComponentRegistry.h"

#import <os/lock.h>

@implementation RuneComponentDescriptor

- (instancetype)initWithType:(NSString *)type {
  if (self = [super init]) {
    _type = [type copy];
  }
  return self;
}

@end

static NSMutableDictionary<NSString *, RuneComponentDescriptor *> *RuneComponentRegistryDict(void) {
  static NSMutableDictionary<NSString *, RuneComponentDescriptor *> *registry;
  static os_unfair_lock lock = OS_UNFAIR_LOCK_INIT;
  os_unfair_lock_lock(&lock);
  if (!registry) {
    registry = [NSMutableDictionary new];
  }
  os_unfair_lock_unlock(&lock);
  return registry;
}

void RuneRegisterComponentDescriptor(RuneComponentDescriptor *descriptor) {
  if (!descriptor.type.length) {
    NSLog(@"[RuneKit] Attempted to register component with empty type. Ignoring.");
    return;
  }

  NSMutableDictionary<NSString *, RuneComponentDescriptor *> *registry = RuneComponentRegistryDict();
  @synchronized (registry) {
    RuneComponentDescriptor *existing = registry[descriptor.type];
    if (existing && existing != descriptor) {
      NSLog(@"[RuneKit] Replacing existing component descriptor for type '%@'.", descriptor.type);
    }
    registry[descriptor.type] = descriptor;
  }
}

RuneComponentDescriptor *_Nullable RuneGetComponentDescriptor(NSString *type) {
  if (!type.length) {
    return nil;
  }
  NSMutableDictionary<NSString *, RuneComponentDescriptor *> *registry = RuneComponentRegistryDict();
  @synchronized (registry) {
    return registry[type];
  }
}

NSArray<RuneComponentDescriptor *> *RuneAllComponentDescriptors(void) {
  NSMutableDictionary<NSString *, RuneComponentDescriptor *> *registry = RuneComponentRegistryDict();
  @synchronized (registry) {
    return registry.allValues.copy;
  }
}
