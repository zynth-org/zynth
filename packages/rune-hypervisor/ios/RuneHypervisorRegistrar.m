#import <Foundation/Foundation.h>
#import "RuneComponentRegistry.h"
#import "RuneKit/SNUIManager.h" // For SNNode and SNUIManager

#if __has_include(<RuneHypervisor/RuneHypervisor-Swift.h>)
#import <RuneHypervisor/RuneHypervisor-Swift.h>
#elif __has_include("RuneHypervisor-Swift.h")
#import "RuneHypervisor-Swift.h"
#endif

@interface RuneHypervisorRegistrar : NSObject <RuneComponentRegistrar>
@end

@implementation RuneHypervisorRegistrar

- (void)register:(RuneComponentRegistry *)registry {
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-hypervisor-view"];
    
    descriptor.createView = ^UIView * _Nullable(SNUIManager * _Nonnull manager, NSString * _Nonnull type) {
        return [[RuneHypervisorView alloc] init];
    };
    
    descriptor.handleSetProp = ^BOOL(SNUIManager * _Nonnull manager, SNNode * _Nonnull node, NSString * _Nonnull name, id  _Nullable value, NSString * _Nonnull rawJSON) {
        if (![node.view isKindOfClass:[RuneHypervisorView class]]) {
            return NO;
        }
        RuneHypervisorView *view = (RuneHypervisorView *)node.view;
        
        if ([name isEqualToString:@"source"]) {
            if ([value isKindOfClass:[NSDictionary class]]) {
                view.source = (NSDictionary *)value;
                return YES;
            }
        } else if ([name isEqualToString:@"onLoad"]) {
            // Handlers are typically JSValue callbacks.
            // For now, we store them as blocks.
            // A more robust solution would involve a JSBridge-like mechanism.
            view.onLoad = ^{
                // Assuming `value` is a JSValue callback if from manager.
                // For now, this is a native-to-native callback.
                // This will need to trigger a JS event.
            };
            return YES;
        } else if ([name isEqualToString:@"onError"]) {
            view.onError = ^(NSDictionary *errorInfo) {
                // This will need to trigger a JS event.
            };
            return YES;
        } else if ([name isEqualToString:@"onMessage"]) {
            view.onMessage = ^(NSDictionary *message) {
                // This will need to trigger a JS event.
            };
            return YES;
        } else if ([name isEqualToString:@"reload"]) { // This is an imperative call, not a prop.
            if ([value boolValue]) { // Expecting a boolean or trigger
                [view reload];
            }
            return YES; // Consumed property
        } else if ([name isEqualToString:@"destroy"]) { // This is an imperative call.
            if ([value boolValue]) { // Expecting a boolean or trigger
                [view destroy];
            }
            return YES; // Consumed property
        }
        return NO;
    };
    
    // Cleanup block for when the node is removed
    descriptor.cleanup = ^(SNUIManager * _Nonnull manager, SNNode * _Nonnull node) {
        if ([node.view isKindOfClass:[RuneHypervisorView class]]) {
            [(RuneHypervisorView *)node.view destroy];
        }
    };
    
    [registry register:descriptor];
}

@end
