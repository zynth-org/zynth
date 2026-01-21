#import "ZynthUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (Events)

- (NSString *)pointerEventsForNode:(NSNumber *)nodeId;
- (void)updateInteractionStateForNode:(NSNumber *)nodeId;
- (void)attachPressRecognizerForNode:(NSNumber *)nodeId;
- (void)handlePressGesture:(UILongPressGestureRecognizer *)recognizer;
- (NSTimeInterval)longPressDurationForNode:(NSNumber *)nodeId;
- (NSTimeInterval)doublePressWindowForNode:(NSNumber *)nodeId;
- (void)cancelLongPressTimerForNode:(NSNumber *)nodeId;
- (void)scheduleLongPressTimerForNode:(NSNumber *)nodeId;
- (void)maybeDispatchDoublePressForNode:(NSNumber *)nodeId timestampMs:(double)timestampMs;
- (void)dispatchLayoutEvents;
- (void)cleanupNode:(NSNumber *)nodeId;

@end

NS_ASSUME_NONNULL_END
