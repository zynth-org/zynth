#import "SNUIManager+Internal.h"
#import "RuneTextInputView.h"

NS_ASSUME_NONNULL_BEGIN

@interface SNUIManager (RuneTextInput)

- (UIView *_Nullable)sn_textInputCreateView;
- (void)sn_textInputAttachNode:(SNNode *)node view:(RuneTextInputView *)view;
- (BOOL)sn_textInputHandlesSetPropForNode:(SNNode *)node
                                     name:(NSString *)name
                                    value:(id)value
                                   rawJSON:(NSString *)json;
- (BOOL)sn_textInputHandlesSetPropCallbackForNode:(SNNode *)node
                                             name:(NSString *)name
                                         callback:(JSValue *_Nullable)callback;
- (BOOL)sn_textInputHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name;
- (void)sn_textInputCleanupNode:(SNNode *)node;
- (void)sn_textInputResetStates;
- (void)sn_textInputUpdateTextForNode:(SNNode *)node text:(NSString *)text;
- (void)sn_textInputSelectionDidChangeForNode:(SNNode *)node;

@end

NS_ASSUME_NONNULL_END
