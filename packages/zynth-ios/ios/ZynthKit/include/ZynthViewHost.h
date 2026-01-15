#ifndef ZYNTH_VIEW_HOST_H
#define ZYNTH_VIEW_HOST_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
#endif

typedef NS_ENUM(NSInteger, ZynthPointerEventsMode) {
  ZynthPointerEventsAuto = 0,
  ZynthPointerEventsNone,
  ZynthPointerEventsBoxNone,
  ZynthPointerEventsBoxOnly
};

NS_INLINE ZynthPointerEventsMode ZynthPointerEventsFromString(NSString *value) {
  if (![value isKindOfClass:[NSString class]] || value.length == 0) return ZynthPointerEventsAuto;
  if ([value isEqualToString:@"none"]) return ZynthPointerEventsNone;
  if ([value isEqualToString:@"box-none"]) return ZynthPointerEventsBoxNone;
  if ([value isEqualToString:@"box-only"]) return ZynthPointerEventsBoxOnly;
  return ZynthPointerEventsAuto;
}

#endif

#endif /* ZYNTH_VIEW_HOST_H */
