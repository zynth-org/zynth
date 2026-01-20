#import "ZynthUIManager.h"

@implementation ZynthUIManager {
  __weak UIView *_rootView;
  int _nextId;
}

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _nextId = 1;
  }
  return self;
}

- (NSNumber *)createNode:(NSString *)type {
  (void)type;
  return @(_nextId++);
}

- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json {
  (void)nodeId;
  (void)name;
  (void)json;
}

- (void)setText:(NSNumber *)nodeId text:(NSString *)text {
  (void)nodeId;
  (void)text;
}

- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index {
  (void)parentId;
  (void)childId;
  (void)index;
}

- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId {
  (void)parentId;
  (void)childId;
}

- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name {
  (void)nodeId;
  (void)name;
}

- (void)applyBatch:(NSString *)batchJSON {
  (void)batchJSON;
}

- (void)setSurface:(NSNumber *)surfaceId {
  (void)surfaceId;
}

- (void)flush {
}

@end
