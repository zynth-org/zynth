#import <UIKit/UIKit.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthTextFieldView : UIView <UITextFieldDelegate>

@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) ZynthPointerEventsMode pointerMode;

/// The underlying UITextField
@property(nonatomic, strong, readonly) UITextField *textField;

/// Event callbacks
@property(nonatomic, copy, nullable) void (^onChange)(NSString *value);
@property(nonatomic, copy, nullable) void (^onFocus)(void);
@property(nonatomic, copy, nullable) void (^onBlur)(void);
@property(nonatomic, copy, nullable) void (^onSubmit)(NSString *value);

/// Property setters
- (void)zynth_setValue:(NSString *)value;
- (void)zynth_setPlaceholder:(NSString *)placeholder;
- (void)zynth_setDisabled:(BOOL)disabled;
- (void)zynth_setEditable:(BOOL)editable;
- (void)zynth_setSecureTextEntry:(BOOL)secure;
- (void)zynth_setKeyboardType:(NSString *)keyboardType;
- (void)zynth_setReturnKeyType:(NSString *)returnKeyType;
- (void)zynth_setAutoCapitalize:(NSString *)autoCapitalize;
- (void)zynth_setAutoCorrect:(BOOL)autoCorrect;
- (void)zynth_setMaxLength:(NSInteger)maxLength;
- (void)zynth_setVariant:(NSString *)variant;

/// Styling
- (void)zynth_setBackgroundColor:(UIColor *_Nullable)color;
- (void)zynth_setBorderRadius:(CGFloat)radius;
- (void)zynth_setBorderWidth:(CGFloat)width;
- (void)zynth_setBorderColor:(UIColor *_Nullable)color;
- (void)zynth_setTextColor:(UIColor *_Nullable)color;
- (void)zynth_setPlaceholderColor:(UIColor *_Nullable)color;

/// Focus control
- (void)zynth_requestFocus;
- (void)zynth_requestBlur;

@end

NS_ASSUME_NONNULL_END
