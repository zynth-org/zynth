#import <UIKit/UIKit.h>
#import <Yoga/Yoga.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthNode;
@class ZynthUIManager;

@interface ZynthSecureTextInputView : UITextField

@property(nonatomic, weak, nullable) ZynthUIManager *manager;
@property(nonatomic, weak, nullable) ZynthNode *node;
@property(nonatomic, strong, nullable) UIColor *placeholderTextColor;
@property(nonatomic, assign) UIEdgeInsets padding;

// Prop-backed properties
@property(nonatomic, assign) BOOL blurOnSubmit;
@property(nonatomic, copy) NSString *submitBehavior;
@property(nonatomic, assign) double eventThrottle;

// Event flags
@property(nonatomic, assign) BOOL hasOnChange;
@property(nonatomic, assign) BOOL hasOnChangeText;
@property(nonatomic, assign) BOOL hasOnSelectionChange;
@property(nonatomic, assign) BOOL hasOnSubmitEditing;
@property(nonatomic, assign) BOOL hasOnKeyPress;
@property(nonatomic, assign) BOOL hasOnFocus;
@property(nonatomic, assign) BOOL hasOnBlur;
@property(nonatomic, assign) NSInteger inputHandlerWorkletId;

- (void)applyPlaceholderTextColor:(NSString *_Nullable)hexString;
- (void)applyCaretColor:(NSString *)hexString;
- (void)applySelectionColor:(NSString *)hexString;
- (void)applyPlaceholderToneFromTextColor;

- (CGSize)measureForWidth:(CGFloat)width height:(CGFloat)height widthMode:(YGMeasureMode)widthMode heightMode:(YGMeasureMode)heightMode;

@end

NS_ASSUME_NONNULL_END
