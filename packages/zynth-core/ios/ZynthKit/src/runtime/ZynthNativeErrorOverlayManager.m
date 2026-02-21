#import "ZynthNativeErrorOverlayManager.h"
#import "ZynthRuntime.h"

#import <UIKit/UIKit.h>

@interface ZynthNativeErrorOverlayManager ()
@property(nonatomic, weak) ZynthRuntime *runtime;
@property(nonatomic, weak) UIView *rootView;
@property(nonatomic, strong) UIView *fatalOverlay;
@property(nonatomic, strong) UIView *warningToast;
@property(nonatomic, strong) NSDictionary *tokens;
@property(nonatomic, assign) NSInteger warningCount;
@property(nonatomic, copy) NSString *warningMessage;
@end

@implementation ZynthNativeErrorOverlayManager

+ (instancetype)shared {
  static ZynthNativeErrorOverlayManager *instance;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[ZynthNativeErrorOverlayManager alloc] init];
  });
  return instance;
}

- (instancetype)init {
  self = [super init];
  if (self) {
    _warningMessage = @"";
    NSString *json = @"{\"layout\":{\"screenPadding\":20,\"panelRadius\":18,\"panelPadding\":16,\"buttonHeight\":48},\"colors\":{\"overlayBg\":\"#18181B\",\"panelBg\":\"#0F0F12\",\"border\":\"#27272A\",\"title\":\"#FAFAFA\",\"body\":\"#A1A1AA\",\"error\":\"#F87171\",\"warning\":\"#FACC15\",\"neutralButton\":\"#27272A\",\"dangerButton\":\"#DC2626\",\"warningToastBg\":\"#242014\",\"warningToastBorder\":\"#695511\",\"buttonText\":\"#E4E4E7\"}}";
    NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
    if (data) {
      id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if ([parsed isKindOfClass:[NSDictionary class]]) {
        _tokens = (NSDictionary *)parsed;
      }
    }
    if (_tokens == nil) {
      _tokens = @{};
    }
  }
  return self;
}

- (void)attachRuntime:(ZynthRuntime *)runtime {
  self.runtime = runtime;
  self.rootView = runtime.rootView;
}

- (void)detach {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.fatalOverlay removeFromSuperview];
    [self.warningToast removeFromSuperview];
    self.fatalOverlay = nil;
    self.warningToast = nil;
    self.warningCount = 0;
    self.warningMessage = @"";
  });
  self.runtime = nil;
  self.rootView = nil;
}

- (void)handleRawEventJSON:(NSString *)json {
  if (json.length == 0) return;
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) return;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
  if (error != nil || ![parsed isKindOfClass:[NSDictionary class]]) return;
  NSDictionary *root = (NSDictionary *)parsed;
  NSDictionary *event = [root[@"event"] isKindOfClass:[NSDictionary class]] ? root[@"event"] : root;
  NSString *topic = [event[@"topic"] isKindOfClass:[NSString class]] ? event[@"topic"] : @"";
  if (topic.length == 0) return;
  NSString *level = [event[@"level"] isKindOfClass:[NSString class]] ? event[@"level"] : nil;
  NSString *tag = [event[@"tag"] isKindOfClass:[NSString class]] ? event[@"tag"] : nil;
  [self handleEventWithTopic:topic level:level tag:tag data:event[@"data"]];
}

- (void)handleEventWithTopic:(NSString *)topic
                       level:(NSString *_Nullable)level
                         tag:(NSString *_Nullable)tag
                        data:(id _Nullable)data {
  (void)tag;
  if (topic.length == 0) return;

  if ([topic isEqualToString:@"log/console"] && [level isEqualToString:@"warn"]) {
    NSString *message = [self readMessage:data];
    dispatch_async(dispatch_get_main_queue(), ^{
      [self showWarningToast:message];
    });
    return;
  }

  BOOL isFatal = [topic hasPrefix:@"error/"] || [topic hasPrefix:@"crash/"];
  if (!isFatal) return;

  NSString *message = [self readMessage:data];
  NSString *stack = [self readStack:data];
  NSString *title = [topic hasPrefix:@"crash/"] ? @"Native Crash" : @"Runtime Error";
  dispatch_async(dispatch_get_main_queue(), ^{
    [self showFatalOverlayWithTitle:title topic:topic message:message stack:stack];
  });
}

- (NSString *)readMessage:(id)data {
  if ([data isKindOfClass:[NSString class]]) {
    NSString *value = [(NSString *)data stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (value.length == 0) return @"Unknown error";
    NSRange lineBreak = [value rangeOfString:@"\n"];
    if (lineBreak.location == NSNotFound) return value;
    return [value substringToIndex:lineBreak.location];
  }
  if ([data isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)data;
    NSString *message = [dict[@"message"] isKindOfClass:[NSString class]] ? dict[@"message"] : nil;
    if (message.length == 0) {
      message = [dict[@"reason"] isKindOfClass:[NSString class]] ? dict[@"reason"] : nil;
    }
    if (message.length == 0) {
      message = [dict[@"error"] isKindOfClass:[NSString class]] ? dict[@"error"] : nil;
    }
    return message.length > 0 ? message : @"Unknown error";
  }
  return @"Unknown error";
}

- (NSString *_Nullable)readStack:(id)data {
  if ([data isKindOfClass:[NSString class]]) {
    NSString *value = [(NSString *)data stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSRange lineBreak = [value rangeOfString:@"\n"];
    if (lineBreak.location == NSNotFound || lineBreak.location + 1 >= value.length) return nil;
    NSString *stack = [value substringFromIndex:lineBreak.location + 1];
    return stack.length > 0 ? stack : nil;
  }
  if ([data isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)data;
    NSString *stack = [dict[@"stack"] isKindOfClass:[NSString class]] ? dict[@"stack"] : nil;
    if (stack.length == 0) {
      stack = [dict[@"stacktrace"] isKindOfClass:[NSString class]] ? dict[@"stacktrace"] : nil;
    }
    return stack.length > 0 ? stack : nil;
  }
  return nil;
}

- (void)showFatalOverlayWithTitle:(NSString *)title
                            topic:(NSString *)topic
                          message:(NSString *)message
                            stack:(NSString *_Nullable)stack {
  UIView *root = self.rootView;
  if (!root) return;

  [self.warningToast removeFromSuperview];
  self.warningToast = nil;
  self.warningCount = 0;
  self.warningMessage = @"";

  UIView *overlay = [[UIView alloc] initWithFrame:root.bounds];
  overlay.backgroundColor = [self colorToken:@"overlayBg" fallback:@"#18181B"];
  overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  overlay.userInteractionEnabled = YES;

  UIView *panel = [[UIView alloc] init];
  panel.backgroundColor = [self colorToken:@"panelBg" fallback:@"#0F0F12"];
  panel.layer.cornerRadius = [self layoutToken:@"panelRadius" fallback:18.0];
  panel.layer.borderWidth = 1.0;
  panel.layer.borderColor = [self colorToken:@"border" fallback:@"#27272A"].CGColor;
  panel.translatesAutoresizingMaskIntoConstraints = NO;
  [overlay addSubview:panel];

  UILabel *titleLabel = [[UILabel alloc] init];
  titleLabel.text = title;
  titleLabel.textColor = [self colorToken:@"title" fallback:@"#FAFAFA"];
  titleLabel.font = [UIFont systemFontOfSize:22 weight:UIFontWeightBold];
  titleLabel.numberOfLines = 0;
  titleLabel.translatesAutoresizingMaskIntoConstraints = NO;

  UILabel *messageLabel = [[UILabel alloc] init];
  messageLabel.text = message;
  messageLabel.textColor = [self colorToken:@"error" fallback:@"#F87171"];
  messageLabel.font = [UIFont monospacedSystemFontOfSize:13 weight:UIFontWeightRegular];
  messageLabel.numberOfLines = 0;
  messageLabel.translatesAutoresizingMaskIntoConstraints = NO;

  UILabel *topicLabel = [[UILabel alloc] init];
  topicLabel.text = topic;
  topicLabel.textColor = [self colorToken:@"body" fallback:@"#A1A1AA"];
  topicLabel.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
  topicLabel.numberOfLines = 1;
  topicLabel.translatesAutoresizingMaskIntoConstraints = NO;

  [panel addSubview:titleLabel];
  [panel addSubview:messageLabel];
  [panel addSubview:topicLabel];

  UIScrollView *stackScroll = [[UIScrollView alloc] init];
  stackScroll.layer.cornerRadius = 12.0;
  stackScroll.layer.borderWidth = 1.0;
  stackScroll.layer.borderColor = [self colorToken:@"border" fallback:@"#27272A"].CGColor;
  stackScroll.backgroundColor = [self colorToken:@"overlayBg" fallback:@"#18181B"];
  stackScroll.translatesAutoresizingMaskIntoConstraints = NO;
  [panel addSubview:stackScroll];

  UILabel *stackLabel = [[UILabel alloc] init];
  stackLabel.text = stack.length > 0 ? stack : @"No stack trace available.";
  stackLabel.textColor = [self colorToken:@"body" fallback:@"#A1A1AA"];
  stackLabel.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
  stackLabel.numberOfLines = 0;
  stackLabel.translatesAutoresizingMaskIntoConstraints = NO;
  [stackScroll addSubview:stackLabel];

  UIButton *dismissButton = [self button:@"Dismiss"
                                   color:[self colorToken:@"neutralButton" fallback:@"#27272A"]
                                  action:@selector(onDismissPressed)];
  UIButton *reloadButton = [self button:@"Reload"
                                  color:[self colorToken:@"dangerButton" fallback:@"#DC2626"]
                                 action:@selector(onReloadPressed)];
  dismissButton.translatesAutoresizingMaskIntoConstraints = NO;
  reloadButton.translatesAutoresizingMaskIntoConstraints = NO;
  [panel addSubview:dismissButton];
  [panel addSubview:reloadButton];

  [NSLayoutConstraint activateConstraints:@[
    [panel.leadingAnchor constraintEqualToAnchor:overlay.leadingAnchor constant:[self layoutToken:@"screenPadding" fallback:20.0]],
    [panel.trailingAnchor constraintEqualToAnchor:overlay.trailingAnchor constant:-[self layoutToken:@"screenPadding" fallback:20.0]],
    [panel.centerYAnchor constraintEqualToAnchor:overlay.centerYAnchor],

    [titleLabel.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:[self layoutToken:@"panelPadding" fallback:16.0]],
    [titleLabel.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor constant:-[self layoutToken:@"panelPadding" fallback:16.0]],
    [titleLabel.topAnchor constraintEqualToAnchor:panel.topAnchor constant:[self layoutToken:@"panelPadding" fallback:16.0]],

    [messageLabel.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
    [messageLabel.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],
    [messageLabel.topAnchor constraintEqualToAnchor:titleLabel.topAnchor constant:40],

    [topicLabel.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
    [topicLabel.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],
    [topicLabel.topAnchor constraintEqualToAnchor:messageLabel.bottomAnchor constant:8],

    [stackScroll.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
    [stackScroll.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],
    [stackScroll.topAnchor constraintEqualToAnchor:topicLabel.bottomAnchor constant:12],
    [stackScroll.heightAnchor constraintEqualToConstant:220],

    [stackLabel.leadingAnchor constraintEqualToAnchor:stackScroll.leadingAnchor constant:10],
    [stackLabel.trailingAnchor constraintEqualToAnchor:stackScroll.trailingAnchor constant:-10],
    [stackLabel.topAnchor constraintEqualToAnchor:stackScroll.topAnchor constant:10],
    [stackLabel.bottomAnchor constraintEqualToAnchor:stackScroll.bottomAnchor constant:-10],
    [stackLabel.widthAnchor constraintEqualToAnchor:stackScroll.widthAnchor constant:-20],

    [dismissButton.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
    [dismissButton.topAnchor constraintEqualToAnchor:stackScroll.bottomAnchor constant:12],
    [dismissButton.heightAnchor constraintEqualToConstant:[self layoutToken:@"buttonHeight" fallback:48.0]],
    [dismissButton.bottomAnchor constraintEqualToAnchor:panel.bottomAnchor constant:-[self layoutToken:@"panelPadding" fallback:16.0]],

    [reloadButton.leadingAnchor constraintEqualToAnchor:dismissButton.trailingAnchor constant:8],
    [reloadButton.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],
    [reloadButton.widthAnchor constraintEqualToAnchor:dismissButton.widthAnchor],
    [reloadButton.topAnchor constraintEqualToAnchor:dismissButton.topAnchor],
    [reloadButton.heightAnchor constraintEqualToAnchor:dismissButton.heightAnchor],
  ]];

  [self.fatalOverlay removeFromSuperview];
  self.fatalOverlay = overlay;
  [root addSubview:overlay];
}

- (void)showWarningToast:(NSString *)message {
  UIView *root = self.rootView;
  if (!root || self.fatalOverlay != nil) return;
  self.warningCount += 1;
  self.warningMessage = message ?: @"";

  UILabel *label = nil;
  if (!self.warningToast) {
    UIView *toast = [[UIView alloc] init];
    toast.backgroundColor = [self colorToken:@"warningToastBg" fallback:@"#242014"];
    toast.layer.cornerRadius = 24.0;
    toast.layer.borderWidth = 1.0;
    toast.layer.borderColor = [self colorToken:@"warningToastBorder" fallback:@"#695511"].CGColor;
    toast.translatesAutoresizingMaskIntoConstraints = NO;

    UILabel *text = [[UILabel alloc] init];
    text.textColor = [self colorToken:@"warning" fallback:@"#FACC15"];
    text.font = [UIFont systemFontOfSize:12 weight:UIFontWeightBold];
    text.numberOfLines = 2;
    text.translatesAutoresizingMaskIntoConstraints = NO;
    [toast addSubview:text];
    label = text;

    UIButton *close = [self button:@"Close"
                             color:[self colorToken:@"neutralButton" fallback:@"#27272A"]
                            action:@selector(onCloseWarningPressed)];
    close.translatesAutoresizingMaskIntoConstraints = NO;
    [toast addSubview:close];

    [NSLayoutConstraint activateConstraints:@[
      [text.leadingAnchor constraintEqualToAnchor:toast.leadingAnchor constant:12],
      [text.centerYAnchor constraintEqualToAnchor:toast.centerYAnchor],
      [close.leadingAnchor constraintEqualToAnchor:text.trailingAnchor constant:12],
      [close.trailingAnchor constraintEqualToAnchor:toast.trailingAnchor constant:-12],
      [close.centerYAnchor constraintEqualToAnchor:toast.centerYAnchor],
      [close.heightAnchor constraintEqualToConstant:38],
      [text.topAnchor constraintEqualToAnchor:toast.topAnchor constant:10],
      [text.bottomAnchor constraintEqualToAnchor:toast.bottomAnchor constant:-10],
    ]];

    [root addSubview:toast];
    [NSLayoutConstraint activateConstraints:@[
      [toast.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:[self layoutToken:@"screenPadding" fallback:20.0]],
      [toast.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-[self layoutToken:@"screenPadding" fallback:20.0]],
      [toast.bottomAnchor constraintEqualToAnchor:root.bottomAnchor constant:-24],
    ]];
    self.warningToast = toast;
  } else {
    for (UIView *subview in self.warningToast.subviews) {
      if ([subview isKindOfClass:[UILabel class]]) {
        label = (UILabel *)subview;
        break;
      }
    }
  }

  if (label) {
    if (self.warningCount > 1) {
      label.text = [NSString stringWithFormat:@"Warning (%ld): %@", (long)self.warningCount, self.warningMessage];
    } else {
      label.text = [NSString stringWithFormat:@"Warning: %@", self.warningMessage];
    }
  }
}

- (UIButton *)button:(NSString *)title color:(UIColor *)color action:(SEL)action {
  UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
  [button setTitle:title forState:UIControlStateNormal];
  [button setTitleColor:[self colorToken:@"buttonText" fallback:@"#E4E4E7"] forState:UIControlStateNormal];
  button.backgroundColor = color;
  button.layer.cornerRadius = 12.0;
  button.titleLabel.font = [UIFont systemFontOfSize:14 weight:UIFontWeightBold];
  [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
  return button;
}

- (CGFloat)layoutToken:(NSString *)name fallback:(CGFloat)fallback {
  NSDictionary *layout = [self.tokens[@"layout"] isKindOfClass:[NSDictionary class]] ? self.tokens[@"layout"] : nil;
  NSNumber *value = [layout[name] isKindOfClass:[NSNumber class]] ? layout[name] : nil;
  return value != nil ? value.doubleValue : fallback;
}

- (UIColor *)colorToken:(NSString *)name fallback:(NSString *)fallbackHex {
  NSDictionary *colors = [self.tokens[@"colors"] isKindOfClass:[NSDictionary class]] ? self.tokens[@"colors"] : nil;
  NSString *hex = [colors[name] isKindOfClass:[NSString class]] ? colors[name] : fallbackHex;
  return [self color:hex];
}

- (UIColor *)color:(NSString *)hex {
  NSString *clean = [[hex stringByReplacingOccurrencesOfString:@"#" withString:@""] uppercaseString];
  if (clean.length != 6) return UIColor.blackColor;
  unsigned int rgb = 0;
  [[NSScanner scannerWithString:clean] scanHexInt:&rgb];
  CGFloat r = ((rgb >> 16) & 0xFF) / 255.0;
  CGFloat g = ((rgb >> 8) & 0xFF) / 255.0;
  CGFloat b = (rgb & 0xFF) / 255.0;
  return [UIColor colorWithRed:r green:g blue:b alpha:1.0];
}

- (void)onDismissPressed {
  [self.fatalOverlay removeFromSuperview];
  self.fatalOverlay = nil;
}

- (void)onReloadPressed {
  ZynthRuntime *runtime = self.runtime;
  if (runtime) {
    [runtime callGlobal:@"__zynth_rerenderApp" args:@[]];
  }
  [self onDismissPressed];
}

- (void)onCloseWarningPressed {
  [self.warningToast removeFromSuperview];
  self.warningToast = nil;
  self.warningCount = 0;
  self.warningMessage = @"";
}

@end
