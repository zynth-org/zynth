#ifndef RUNEJSINVOKER_H
#define RUNEJSINVOKER_H

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol RuneJSInvoker <NSObject>
- (void)invokeHandlerForNode:(int)nid name:(NSString *)name;
@end

NS_ASSUME_NONNULL_END

#endif /* RUNEJSINVOKER_H */
