#import "ZynthTextView.h"

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "SNNode.h"
#endif

@implementation ZynthTextView

- (instancetype)init {
  if (self = [super init]) {
    self.textColor = [UIColor blackColor];
    self.numberOfLines = 0;
    self.zynth_baseTextAttributes = nil;
    self.zynth_textTransform = nil;
    self.zynth_hasExplicitFontSize = NO;
    self.zynth_explicitFontFamily = nil;
  }
  return self;
}

- (void)zynth_refreshComposedText {
  SNNode *node = self.zynth_node;
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
