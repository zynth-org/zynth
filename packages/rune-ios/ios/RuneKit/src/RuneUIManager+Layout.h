#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>

#import "SNUIManager+Internal.h"

@interface SNUIManager (RuneLayout)

- (void)rune_markNeedsFlush;
- (void)rune_displayLinkTick:(CADisplayLink *)link;
- (void)rune_startDisplayLinkIfNeeded;
- (void)rune_stopDisplayLink;
- (void)rune_performFlush;
- (void)rune_dispatchLayoutEventForNode:(SNNode *)node force:(BOOL)force;

@end
