#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthNode;

/**
 * A custom UILabel subclass that supports text composition from nested text nodes.
 * This view is managed by the Text component descriptor and handles both direct
 * text content and composition from child text nodes.
 */
@interface ZynthTextView : UILabel

/// Reference to the owning ZynthNode for traversing children during text composition
@property (nonatomic, weak, nullable) ZynthNode *zynth_node;
/// Base text attributes derived from this node's style
@property (nonatomic, strong, nullable) NSDictionary<NSAttributedStringKey, id> *zynth_baseTextAttributes;
/// Optional text transform ("uppercase" | "lowercase" | "capitalize")
@property (nonatomic, copy, nullable) NSString *zynth_textTransform;
/// Whether this node specified an explicit fontSize
@property (nonatomic, assign) BOOL zynth_hasExplicitFontSize;
/// Whether this node specified an explicit fontFamily (e.g., icon fonts)
@property (nonatomic, assign) BOOL zynth_hasExplicitFontFamily;
/// The requested fontFamily string (kept even if the font is not yet resolved)
@property (nonatomic, copy, nullable) NSString *zynth_explicitFontFamily;

/// Refreshes the composed text from all child text nodes
- (void)zynth_refreshComposedText;

@end

NS_ASSUME_NONNULL_END
