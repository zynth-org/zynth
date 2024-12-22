#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UILabel;
#endif

#import "SNUIManager+Internal.h"

@interface SNUIManager (RuneText)

- (void)rune_refreshTextForLabelNode:(SNNode *)node;
- (void)rune_propagateTextChangeFromNode:(SNNode *)node;
- (BOOL)rune_handleTextInsertionForParent:(SNNode *)parent
                                    child:(SNNode *)child
                                  childId:(NSNumber *)childId
                                  atIndex:(NSUInteger)index;
- (BOOL)rune_handleTextRemovalForParent:(SNNode *)parent
                                  child:(SNNode *)child
                                childId:(NSNumber *)childId;

@end

