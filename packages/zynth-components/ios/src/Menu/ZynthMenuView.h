#import <UIKit/UIKit.h>

@interface ZynthMenuView : UIView

@property (nonatomic, copy) void (^onOpen)(void);
@property (nonatomic, copy) void (^onClose)(void);

- (void)updateMenu;

@end
