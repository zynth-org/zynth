#import <UIKit/UIKit.h>

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneTextFieldView : UIView <UITextFieldDelegate>

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) RunePointerEventsMode pointerMode;

/// The underlying UITextField
@property(nonatomic, strong, readonly) UITextField *textField;

/// Event callbacks
@property(nonatomic, copy, nullable) void (^onChange)(NSString *value);
@property(nonatomic, copy, nullable) void (^onFocus)(void);
@property(nonatomic, copy, nullable) void (^onBlur)(void);
@property(nonatomic, copy, nullable) void (^onSubmit)(NSString *value);

/// Property setters
- (void)rune_setValue:(NSString *)value;
- (void)rune_setPlaceholder:(NSString *)placeholder;
- (void)rune_setDisabled:(BOOL)disabled;
- (void)rune_setEditable:(BOOL)editable;
- (void)rune_setSecureTextEntry:(BOOL)secure;
- (void)rune_setKeyboardType:(NSString *)keyboardType;
- (void)rune_setReturnKeyType:(NSString *)returnKeyType;
- (void)rune_setAutoCapitalize:(NSString *)autoCapitalize;
- (void)rune_setAutoCorrect:(BOOL)autoCorrect;
- (void)rune_setMaxLength:(NSInteger)maxLength;
- (void)rune_setVariant:(NSString *)variant;

/// Styling
- (void)rune_setBackgroundColor:(UIColor *_Nullable)color;
- (void)rune_setBorderRadius:(CGFloat)radius;
- (void)rune_setBorderWidth:(CGFloat)width;
- (void)rune_setBorderColor:(UIColor *_Nullable)color;
- (void)rune_setTextColor:(UIColor *_Nullable)color;
- (void)rune_setPlaceholderColor:(UIColor *_Nullable)color;

/// Focus control
- (void)rune_requestFocus;
- (void)rune_requestBlur;

@end

NS_ASSUME_NONNULL_END
