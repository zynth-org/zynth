#import <UIKit/UIKit.h>

@interface ZynthMenuItemView : UIView

@property (nonatomic, copy) NSString *label;
@property (nonatomic, assign) BOOL destructive;
@property (nonatomic, assign) BOOL disabled;
@property (nonatomic, copy) void (^onPress)(void);

- (UIImage * _Nullable)imageFromIcon;

@end
