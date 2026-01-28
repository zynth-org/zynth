#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
#endif

#import "ZynthViewHost.h"

@interface ZynthPointerEventsView : UIView

@property (nonatomic, assign) ZynthPointerEventsMode pointerMode;

@end
