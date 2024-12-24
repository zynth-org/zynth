#import "SNUIManager.h"
#import "RuneSecureTextInputView.h"

NS_ASSUME_NONNULL_BEGIN

@interface SNUIManager (RuneSecureTextInput)

- (UIView *)sn_secureTextInputCreateView;

- (void)sn_secureTextInputAttachNode:(SNNode *)node view:(RuneSecureTextInputView *)view;

- (BOOL)sn_secureTextInputHandlesSetPropForNode:(SNNode *)node
                                         name:(NSString *)name
                                        value:(id)value
                                      rawJSON:(NSString *)json;

- (BOOL)sn_secureTextInputHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name;

- (void)sn_secureTextInputCleanupNode:(SNNode *)node;

@end

NS_ASSUME_NONNULL_END
