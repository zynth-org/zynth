#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthRuntime : NSObject

- (instancetype)initWithRootView:(UIView *)rootView;
- (BOOL)loadInitialBundleWithJsBundleURL:(NSURL *_Nullable)url
                                   error:(NSError *_Nullable *_Nullable)error;
- (void)startWithRootId:(int)rootId;
- (void)emitEventWithName:(NSString *)name payload:(id _Nullable)payload;
- (void)destroy;

@end

NS_ASSUME_NONNULL_END
