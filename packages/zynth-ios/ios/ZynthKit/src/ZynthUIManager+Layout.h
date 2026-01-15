#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>

#import "SNUIManager+Internal.h"

@interface SNUIManager (ZynthLayout)

- (void)zynth_markNeedsFlush;
- (void)zynth_displayLinkTick:(CADisplayLink *)link;
- (void)zynth_startDisplayLinkIfNeeded;
- (void)zynth_stopDisplayLink;
- (void)zynth_performFlush;
- (void)zynth_dispatchLayoutEventForNode:(SNNode *)node force:(BOOL)force;

@end
