#ifndef RUNE_VIEW_HOST_H
#define RUNE_VIEW_HOST_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
#endif

typedef NS_ENUM(NSInteger, RunePointerEventsMode) {
  RunePointerEventsAuto = 0,
  RunePointerEventsNone,
  RunePointerEventsBoxNone,
  RunePointerEventsBoxOnly
};

NS_INLINE RunePointerEventsMode RunePointerEventsFromString(NSString *value) {
  if (![value isKindOfClass:[NSString class]] || value.length == 0) return RunePointerEventsAuto;
  if ([value isEqualToString:@"none"]) return RunePointerEventsNone;
  if ([value isEqualToString:@"box-none"]) return RunePointerEventsBoxNone;
  if ([value isEqualToString:@"box-only"]) return RunePointerEventsBoxOnly;
  return RunePointerEventsAuto;
}

#endif

#endif /* RUNE_VIEW_HOST_H */
