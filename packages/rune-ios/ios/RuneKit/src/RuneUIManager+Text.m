#import "RuneUIManager+Text.h"

@implementation SNUIManager (RuneText)

- (void)rune_refreshTextForLabelNode:(SNNode *)node {
  if (!node || ![node.view isKindOfClass:[UILabel class]]) return;

  if (node.children.count == 0) {
    ((UILabel *)node.view).text = @"";
    if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
    return;
  }

  NSMutableString *composed = [NSMutableString string];
  for (NSNumber *childId in node.children) {
    SNNode *child = self.nodes[childId];
    if (!child || ![child.view isKindOfClass:[UILabel class]]) continue;
    NSString *childText = ((UILabel *)child.view).text ?: @"";
    [composed appendString:childText];
  }

  ((UILabel *)node.view).text = composed;
  if (node.yoga && YGNodeGetChildCount(node.yoga) == 0 && YGNodeGetOwner(node.yoga)) {
    YGNodeMarkDirty(node.yoga);
  }
}

- (void)rune_propagateTextChangeFromNode:(SNNode *)node {
  if (!node) return;

  int parentId = node.parentId;
  while (parentId > 0) {
    SNNode *parent = self.nodes[@(parentId)];
    if (!parent || ![parent.view isKindOfClass:[UILabel class]]) break;

    [self rune_refreshTextForLabelNode:parent];
    parentId = parent.parentId;
  }
}

- (BOOL)rune_handleTextInsertionForParent:(SNNode *)parent
                                    child:(SNNode *)child
                                  childId:(NSNumber *)childId
                                  atIndex:(NSUInteger)index {
  if (!parent || ![parent.view isKindOfClass:[UILabel class]]) return NO;

  NSUInteger existing = [parent.children indexOfObject:childId];
  if (existing != NSNotFound) {
    [parent.children removeObjectAtIndex:existing];
  }
  NSUInteger targetIndex = MIN(index, parent.children.count);
  [parent.children insertObject:childId atIndex:targetIndex];

  [self rune_refreshTextForLabelNode:parent];
  [self rune_propagateTextChangeFromNode:parent];
  [self sn_markNeedsFlush];
  return YES;
}

- (BOOL)rune_handleTextRemovalForParent:(SNNode *)parent
                                  child:(SNNode *)child
                                childId:(NSNumber *)childId {
  if (!parent || ![parent.view isKindOfClass:[UILabel class]]) return NO;

  NSUInteger idx = [parent.children indexOfObject:childId];
  if (idx != NSNotFound) {
    [parent.children removeObjectAtIndex:idx];
  }

  [self rune_refreshTextForLabelNode:parent];
  [self rune_propagateTextChangeFromNode:parent];
  [self sn_markNeedsFlush];
  return YES;
}

@end
