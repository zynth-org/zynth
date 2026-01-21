#import <UIKit/UIKit.h>

@class ZynthLinearGradient;
@class ZynthShadowLayer;

NS_ASSUME_NONNULL_BEGIN

@interface ZynthViewStyleState : NSObject

@property (nonatomic, strong, nullable) UIColor *backgroundColor;
@property (nonatomic, strong, nullable) ZynthLinearGradient *backgroundGradient;
@property (nonatomic, strong, nullable) UIColor *borderTopColor;
@property (nonatomic, strong, nullable) UIColor *borderRightColor;
@property (nonatomic, strong, nullable) UIColor *borderBottomColor;
@property (nonatomic, strong, nullable) UIColor *borderLeftColor;
@property (nonatomic, assign) CGFloat borderTopWidth;
@property (nonatomic, assign) CGFloat borderRightWidth;
@property (nonatomic, assign) CGFloat borderBottomWidth;
@property (nonatomic, assign) CGFloat borderLeftWidth;
@property (nonatomic, assign) CGFloat borderTopLeftRadius;
@property (nonatomic, assign) CGFloat borderTopRightRadius;
@property (nonatomic, assign) CGFloat borderBottomRightRadius;
@property (nonatomic, assign) CGFloat borderBottomLeftRadius;
@property (nonatomic, copy, nullable) NSString *borderStyle;

@property (nonatomic, strong, nullable) NSArray<ZynthShadowLayer *> *boxShadow;
@property (nonatomic, strong, nullable) UIColor *shadowColor;
@property (nonatomic, strong, nullable) NSNumber *shadowOpacity;
@property (nonatomic, strong, nullable) NSNumber *shadowRadius;
@property (nonatomic, assign) CGSize shadowOffset;
@property (nonatomic, assign) BOOL hasShadowOffset;

@property (nonatomic, assign) BOOL hasTransform;
@property (nonatomic, assign) CATransform3D transform;
@property (nonatomic, copy, nullable) NSString *transformOrigin;

- (void)applyToView:(UIView *)view;
- (void)applyLayoutToView:(UIView *)view;

@end

NS_ASSUME_NONNULL_END
