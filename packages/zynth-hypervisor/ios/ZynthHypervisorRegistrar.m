#import <Foundation/Foundation.h>
#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthComponentRegistry.h"
#import "SNUIManager.h"
#import "SNNode.h"
#endif

// Forward declare the Swift-exposed view to avoid Swift header import issues.
@class ZynthHypervisorView;

// We avoid importing the generated Swift header directly to keep the pod build happy.

// Minimal interface to call into the Swift view without relying on generated headers
@interface ZynthHypervisorView : UIView
@property(nonatomic, strong) NSDictionary *source;
- (void)bindWithManager:(SNUIManager *)manager node:(SNNode *)node;
- (void)reload;
- (void)destroy;
- (void)postMessage:(id)message;
@end

@implementation ZynthHypervisorRegistrar : NSObject

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-hypervisor-view"];
        
        descriptor.createView = ^UIView * _Nullable(SNUIManager * _Nonnull manager, NSString * _Nonnull type) {
            return [[ZynthHypervisorView alloc] init];
        };
        
        descriptor.attach = ^(SNUIManager * _Nonnull manager, SNNode * _Nonnull node) {
            if ([node.view isKindOfClass:[ZynthHypervisorView class]]) {
                [(ZynthHypervisorView *)node.view bindWithManager:manager node:node];
            }
        };
        
        descriptor.handleSetProp = ^BOOL(SNUIManager * _Nonnull manager, SNNode * _Nonnull node, NSString * _Nonnull name, id  _Nullable value, NSString * _Nonnull rawJSON) {
            if (![node.view isKindOfClass:[ZynthHypervisorView class]]) {
                return NO;
            }
            ZynthHypervisorView *view = (ZynthHypervisorView *)node.view;
            
            if ([name isEqualToString:@"source"]) {
                if ([value isKindOfClass:[NSDictionary class]]) {
                    view.source = (NSDictionary *)value;
                    return YES;
                }
            } else if ([name isEqualToString:@"onLoad"]) {
                return YES; // events dispatched via notifyLoad/manager
            } else if ([name isEqualToString:@"onError"]) {
                return YES;
            } else if ([name isEqualToString:@"onMessage"]) {
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
            } else if ([name isEqualToString:@"postMessage"]) { // Imperative call
                 if (value) {
                     [view postMessage:value];
                 }
                 return YES;
            }
            return NO;
        };
        
        // Cleanup block for when the node is removed
        descriptor.cleanup = ^(SNUIManager * _Nonnull manager, SNNode * _Nonnull node) {
            if ([node.view isKindOfClass:[ZynthHypervisorView class]]) {
                [(ZynthHypervisorView *)node.view destroy];
            }
        };
        
        ZynthRegisterComponentDescriptor(descriptor);
    });
}

@end
