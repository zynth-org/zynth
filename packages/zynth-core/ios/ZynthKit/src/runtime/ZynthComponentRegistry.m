#import "ZynthComponentRegistry.h"

@implementation ZynthComponentDescriptor

- (instancetype)initWithType:(NSString *)type {
  if (self = [super init]) {
    _type = [type copy];
  }
  return self;
}

@end

@interface ZynthComponentRegistry ()
@property(nonatomic, strong) NSMutableDictionary<NSString *, ZynthComponentDescriptor *> *descriptors;
@property(nonatomic, strong) NSLock *lock;
@end

@implementation ZynthComponentRegistry

+ (instancetype)shared {
  static ZynthComponentRegistry *instance;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[ZynthComponentRegistry alloc] init];
  });
  return instance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _descriptors = [NSMutableDictionary dictionary];
    _lock = [[NSLock alloc] init];
  }
  return self;
}

- (void)registerDescriptor:(ZynthComponentDescriptor *)descriptor {
  if (descriptor.type.length == 0) return;
  [_lock lock];
  _descriptors[descriptor.type] = descriptor;
  [_lock unlock];
}

- (ZynthComponentDescriptor *_Nullable)getDescriptor:(NSString *)type {
  if (type.length == 0) return nil;
  [_lock lock];
  ZynthComponentDescriptor *descriptor = _descriptors[type];
  [_lock unlock];
  return descriptor;
}

- (NSArray<ZynthComponentDescriptor *> *)allDescriptors {
  [_lock lock];
  NSArray *values = _descriptors.allValues.copy;
  [_lock unlock];
  return values;
}

@end

void ZynthRegisterComponentDescriptor(ZynthComponentDescriptor *descriptor) {
  [[ZynthComponentRegistry shared] registerDescriptor:descriptor];
}

ZynthComponentDescriptor *_Nullable ZynthGetComponentDescriptor(NSString *type) {
  return [[ZynthComponentRegistry shared] getDescriptor:type];
}

NSArray<ZynthComponentDescriptor *> *ZynthAllComponentDescriptors(void) {
  return [[ZynthComponentRegistry shared] allDescriptors];
}
