#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthTextInputContainer : UIView

@property (nonatomic, strong, readonly) UIView *inputView;

- (instancetype)initWithInputView:(UIView *)inputView;

@end

NS_ASSUME_NONNULL_END
