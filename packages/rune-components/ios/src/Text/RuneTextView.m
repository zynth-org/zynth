#import "RuneTextView.h"

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "SNNode.h"
#endif

@implementation RuneTextView

- (instancetype)init {
  if (self = [super init]) {
    self.textColor = [UIColor blackColor];
    self.numberOfLines = 0;
    self.rune_baseTextAttributes = nil;
    self.rune_textTransform = nil;
    self.rune_hasExplicitFontSize = NO;
  }
  return self;
}

- (void)rune_refreshComposedText {
  SNNode *node = self.rune_node;
  if (!node) return;
  
  if (node.children.count == 0) {
    self.text = @"";
    return;
  }
  
  // Compose text from all child text nodes
  NSMutableString *composed = [NSMutableString string];
  for (NSNumber *childId in node.children) {
    // We need to look up the child node, which requires access to the manager
    // This will be handled by the descriptor which has access to the manager
    // For now, this method is just a placeholder that will be called from the descriptor
  }
  
  self.text = composed;
}

@end
