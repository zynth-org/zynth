#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthTextStyleState : NSObject

@property (nonatomic, copy, nullable) NSString *rawText;
@property (nonatomic, assign) BOOL hasLineHeight;
@property (nonatomic, assign) CGFloat lineHeight;
@property (nonatomic, assign) BOOL hasLineSpacing;
@property (nonatomic, assign) CGFloat lineSpacing;
@property (nonatomic, assign) BOOL hasParagraphSpacing;
@property (nonatomic, assign) CGFloat paragraphSpacing;
@property (nonatomic, assign) BOOL hasBaselineShift;
@property (nonatomic, assign) CGFloat baselineShift;
@property (nonatomic, assign) BOOL hasLetterSpacing;
@property (nonatomic, assign) CGFloat letterSpacing;
@property (nonatomic, assign) BOOL hasMinimumFontScale;
@property (nonatomic, assign) CGFloat minimumFontScale;
@property (nonatomic, copy, nullable) NSString *textDecorationLine;
@property (nonatomic, copy, nullable) NSString *textTransform;
@property (nonatomic, copy, nullable) NSString *hyphenation;

- (void)applyToLabel:(UILabel *)label;
- (NSString *)applyTextTransform:(NSString *)text;

@end

NS_ASSUME_NONNULL_END
