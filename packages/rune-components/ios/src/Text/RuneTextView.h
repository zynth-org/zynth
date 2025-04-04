#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class SNNode;

/**
 * A custom UILabel subclass that supports text composition from nested text nodes.
 * This view is managed by the Text component descriptor and handles both direct
 * text content and composition from child text nodes.
 */
@interface RuneTextView : UILabel

/// Reference to the owning SNNode for traversing children during text composition
@property (nonatomic, weak, nullable) SNNode *rune_node;

/// Refreshes the composed text from all child text nodes
- (void)rune_refreshComposedText;

@end

NS_ASSUME_NONNULL_END
