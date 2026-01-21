#import "ZynthUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (Style)

- (BOOL)applyStyleProp:(NSNumber *)nodeId
                  view:(UIView *)view
                  name:(NSString *)name
                 value:(NSString *)value;
- (void)applyStyleLayoutIfNeeded;
- (void)applyTextValue:(NSNumber *)nodeId label:(UILabel *)label text:(NSString *)text;

@end

NS_ASSUME_NONNULL_END
