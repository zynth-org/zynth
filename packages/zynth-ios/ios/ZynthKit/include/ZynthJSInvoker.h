#ifndef ZYNTHJSINVOKER_H
#define ZYNTHJSINVOKER_H

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol ZynthJSInvoker <NSObject>
- (void)invokeHandlerForNode:(int)nid name:(NSString *)name;
@end

NS_ASSUME_NONNULL_END

#endif /* ZYNTHJSINVOKER_H */
