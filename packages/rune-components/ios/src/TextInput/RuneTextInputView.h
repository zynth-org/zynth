#import <UIKit/UIKit.h>
#import <Yoga/Yoga.h>

@class SNUIManager;
@class SNNode;

NS_ASSUME_NONNULL_BEGIN

@interface RuneTextInputView : UITextView <UITextViewDelegate>

@property(nonatomic, weak) SNUIManager *manager;
@property(nonatomic, weak) SNNode *node;
@property(nonatomic, copy, nullable) NSString *placeholder;
@property(nonatomic, strong, nullable) UIColor *placeholderTextColor;
@property(nonatomic, assign) BOOL blurOnSubmit;
@property(nonatomic, assign) BOOL multiline;
@property(nonatomic, assign) NSInteger maxLength;
@property(nonatomic, assign) NSInteger numberOfLinesHint;
@property(nonatomic, assign) NSTimeInterval eventThrottle;
@property(nonatomic, assign) BOOL hasOnChange;
@property(nonatomic, assign) BOOL hasOnChangeText;
@property(nonatomic, assign) BOOL hasOnSelectionChange;
@property(nonatomic, assign) BOOL hasOnFocus;
@property(nonatomic, assign) BOOL hasOnBlur;
@property(nonatomic, assign) BOOL hasOnSubmitEditing;
@property(nonatomic, assign) BOOL hasOnKeyPress;
@property(nonatomic, assign) BOOL hasOnCompositionStart;
@property(nonatomic, assign) BOOL hasOnCompositionEnd;
@property(nonatomic, assign, getter=isComposing) BOOL composing;
@property(nonatomic, assign) BOOL isEditableProp;
@property(nonatomic, copy) NSString *submitBehavior;

@property (nonatomic, strong, nullable) NSLayoutConstraint *placeholderLeadingConstraint;
@property (nonatomic, strong, nullable) NSLayoutConstraint *placeholderTopConstraint;

- (void)configureDefaults;
- (void)applySelectionFromDictionary:(NSDictionary *_Nullable)dict;
- (NSDictionary *)currentSelectionPayload;
- (void)applyInputMode:(NSString *_Nullable)mode;
- (void)applyAutoCapitalize:(NSString *_Nullable)mode;
- (void)applyAutoCorrect:(NSNumber *_Nullable)flag;
- (void)applySpellCheck:(NSNumber *_Nullable)flag;
- (void)applyReturnKeyType:(NSString *_Nullable)type;
- (void)updatePlaceholderVisibility;
- (void)applyPlaceholderTextColor:(NSString *_Nullable)hexString;
- (void)applyCaretColor:(NSString *_Nullable)hexString;
- (void)applySelectionColor:(NSString *_Nullable)hexString;
- (void)applySecureEntry:(BOOL)secure;
- (void)applyEditable:(BOOL)editable;
- (void)applyMultiline:(BOOL)multiline numberOfLines:(NSInteger)hint;
- (void)applyPlaceholderToneFromTextColor;
- (void)emitFocusIfNeeded;
- (void)emitBlurIfNeeded;
- (void)emitSelectionChanged;
- (void)emitChangeWithRange:(NSRange)range inserted:(NSString *)inserted removed:(NSString *)removed;
- (void)emitKeyEventForReplacement:(NSString *)replacement;
- (CGSize)measureForWidth:(CGFloat)width height:(CGFloat)height widthMode:(YGMeasureMode)widthMode heightMode:(YGMeasureMode)heightMode;
- (void)performProgrammaticUpdate:(dispatch_block_t)block;

@end

NS_ASSUME_NONNULL_END
