#import <UIKit/UIKit.h>

@interface RuneMenuView : UIView

@property (nonatomic, copy) void (^onOpen)(void);
@property (nonatomic, copy) void (^onClose)(void);

- (void)updateMenu;

@end
