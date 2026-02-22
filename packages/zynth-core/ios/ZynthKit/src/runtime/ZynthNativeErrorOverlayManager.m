#import "ZynthNativeErrorOverlayManager.h"
#import "ZynthRuntime.h"

#import <UIKit/UIKit.h>
#import <objc/message.h>
#if __has_include("ZynthKit-Swift.h")
#import "ZynthKit-Swift.h"
#endif

@interface ZynthNativeErrorOverlayManager ()
@property(nonatomic, weak) ZynthRuntime *runtime;
@property(nonatomic, weak) UIView *rootView;
@property(nonatomic, strong) UIView *fatalOverlay;
@property(nonatomic, strong) UIView *warningToast;
@property(nonatomic, strong) NSDictionary *tokens;
@property(nonatomic, assign) NSInteger warningCount;
@property(nonatomic, copy) NSString *warningMessage;
- (NSAttributedString *)styledStackText:(NSString *)stack;
- (void)requestSymbolicationForStack:(NSString *)stack
                                label:(UILabel *)stackBody
                           stackView:(UIView *)stackView
                              overlay:(UIView *)overlay;
@end

static NSString *const ZynthGlyphArrowRight = @"\uea05";
static NSString *const ZynthGlyphTerminal = @"\uea07";
static NSString *const ZynthGlyphClose = @"\uea0a";
static NSString *const ZynthGlyphRefresh = @"\uea0e";

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

  BOOL isWarning = [topic hasPrefix:@"warning/"];
  UIColor *accentColor = isWarning ? [self colorToken:@"warning" fallback:@"#FACC15"]
                                   : [self colorToken:@"error" fallback:@"#F87171"];
  NSString *badgeText = [topic hasPrefix:@"crash/"] ? @"NATIVE ERROR" : @"RUNTIME ERROR";
  NSString *heroTitle = @"An error has occurred.";
  NSString *heroDescription = @"A JavaScript exception was detected, preventing further action.";

  UIView *overlay = [[UIView alloc] initWithFrame:root.bounds];
  overlay.backgroundColor = [self colorToken:@"overlayBg" fallback:@"#18181B"];
  overlay.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  overlay.userInteractionEnabled = YES;
  UILayoutGuide *safe = overlay.safeAreaLayoutGuide;

  UIView *content = [[UIView alloc] init];
  content.translatesAutoresizingMaskIntoConstraints = NO;
  [overlay addSubview:content];

  UIView *footer = [[UIView alloc] init];
  footer.translatesAutoresizingMaskIntoConstraints = NO;
  footer.backgroundColor = [self colorWithAlpha:[self colorToken:@"overlayBg" fallback:@"#18181B"] alpha:0.98];
  footer.layer.borderWidth = 1.0;
  footer.layer.borderColor = [self colorToken:@"border" fallback:@"#27272A"].CGColor;
  [overlay addSubview:footer];

  UILabel *badge = [[UILabel alloc] init];
  badge.translatesAutoresizingMaskIntoConstraints = NO;
  badge.text = [NSString stringWithFormat:@"  %@  ", badgeText];
  badge.textColor = accentColor;
  badge.font = [UIFont systemFontOfSize:11 weight:UIFontWeightHeavy];
  badge.textAlignment = NSTextAlignmentCenter;
  badge.backgroundColor = [self colorWithAlpha:accentColor alpha:0.14];
  badge.layer.cornerRadius = 12.0;
  badge.layer.masksToBounds = YES;
  badge.layer.borderWidth = 1.0;
  badge.layer.borderColor = [self colorWithAlpha:accentColor alpha:0.32].CGColor;
  [content addSubview:badge];

  UILabel *titleLabel = [[UILabel alloc] init];
  titleLabel.translatesAutoresizingMaskIntoConstraints = NO;
  titleLabel.text = heroTitle;
  titleLabel.textColor = [self colorToken:@"title" fallback:@"#FAFAFA"];
  titleLabel.font = [UIFont systemFontOfSize:22 weight:UIFontWeightBold];
  titleLabel.numberOfLines = 0;
  [content addSubview:titleLabel];

  UILabel *subtitleLabel = [[UILabel alloc] init];
  subtitleLabel.translatesAutoresizingMaskIntoConstraints = NO;
  subtitleLabel.text = heroDescription;
  subtitleLabel.textColor = [self colorToken:@"body" fallback:@"#A1A1AA"];
  subtitleLabel.font = [UIFont systemFontOfSize:13 weight:UIFontWeightRegular];
  subtitleLabel.numberOfLines = 3;
  [content addSubview:subtitleLabel];

  UIView *card = [[UIView alloc] init];
  card.translatesAutoresizingMaskIntoConstraints = NO;
  card.backgroundColor = [self colorToken:@"panelBg" fallback:@"#0F0F12"];
  card.layer.cornerRadius = 22.0;
  card.layer.borderWidth = 1.0;
  card.layer.borderColor = [self colorToken:@"border" fallback:@"#27272A"].CGColor;
  [content addSubview:card];

  UIView *iconWrap = [[UIView alloc] init];
  iconWrap.translatesAutoresizingMaskIntoConstraints = NO;
  iconWrap.backgroundColor = [self colorWithAlpha:accentColor alpha:0.3];
  iconWrap.layer.cornerRadius = 14.0;
  [card addSubview:iconWrap];

  UILabel *terminalIcon = [self glyphLabel:ZynthGlyphTerminal color:accentColor size:22];
  terminalIcon.translatesAutoresizingMaskIntoConstraints = NO;
  [iconWrap addSubview:terminalIcon];

  UILabel *messageTitle = [[UILabel alloc] init];
  messageTitle.translatesAutoresizingMaskIntoConstraints = NO;
  messageTitle.text = @"Message";
  messageTitle.textColor = [self color:@"#71717A"];
  messageTitle.font = [UIFont systemFontOfSize:11 weight:UIFontWeightBold];
  [card addSubview:messageTitle];

  UILabel *messageBody = [[UILabel alloc] init];
  messageBody.translatesAutoresizingMaskIntoConstraints = NO;
  messageBody.text = message;
  messageBody.textColor = accentColor;
  messageBody.font = [UIFont monospacedSystemFontOfSize:13 weight:UIFontWeightRegular];
  messageBody.numberOfLines = 4;
  [card addSubview:messageBody];

  UIView *stackLabelRow = [[UIView alloc] init];
  stackLabelRow.translatesAutoresizingMaskIntoConstraints = NO;
  [content addSubview:stackLabelRow];

  UILabel *arrowIcon = [self glyphLabel:ZynthGlyphArrowRight color:[self color:@"#71717A"] size:12];
  arrowIcon.translatesAutoresizingMaskIntoConstraints = NO;
  [stackLabelRow addSubview:arrowIcon];

  UILabel *stackLabelTitle = [[UILabel alloc] init];
  stackLabelTitle.translatesAutoresizingMaskIntoConstraints = NO;
  stackLabelTitle.text = @"STACK TRACE";
  stackLabelTitle.textColor = [self color:@"#71717A"];
  stackLabelTitle.font = [UIFont systemFontOfSize:11 weight:UIFontWeightBlack];
  [stackLabelRow addSubview:stackLabelTitle];

  UIScrollView *stackScroll = [[UIScrollView alloc] init];
  stackScroll.translatesAutoresizingMaskIntoConstraints = NO;
  stackScroll.layer.cornerRadius = 18.0;
  stackScroll.layer.borderWidth = 1.0;
  stackScroll.layer.borderColor = [self colorToken:@"border" fallback:@"#27272A"].CGColor;
  stackScroll.backgroundColor = [self colorWithAlpha:[self colorToken:@"overlayBg" fallback:@"#18181B"] alpha:0.75];
  [content addSubview:stackScroll];

  UILabel *stackBody = [[UILabel alloc] init];
  stackBody.translatesAutoresizingMaskIntoConstraints = NO;
  NSString *initialStack = stack.length > 0 ? stack : @"No stack trace available.";
  stackBody.attributedText = [self styledStackText:initialStack];
  stackBody.textColor = [self colorToken:@"body" fallback:@"#A1A1AA"];
  stackBody.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
  stackBody.numberOfLines = 0;
  [stackScroll addSubview:stackBody];

  UIButton *dismissButton = [self actionButtonWithGlyph:ZynthGlyphClose
                                                  title:@"Dismiss"
                                                  color:[self colorToken:@"neutralButton" fallback:@"#27272A"]
                                                 action:@selector(onDismissPressed)];
  UIButton *reloadButton = [self actionButtonWithGlyph:ZynthGlyphRefresh
                                                 title:@"Reload"
                                                 color:[self colorToken:@"dangerButton" fallback:@"#DC2626"]
                                                action:@selector(onReloadPressed)];
  dismissButton.translatesAutoresizingMaskIntoConstraints = NO;
  reloadButton.translatesAutoresizingMaskIntoConstraints = NO;
  [footer addSubview:dismissButton];
  [footer addSubview:reloadButton];

  CGFloat horizontal = [self layoutToken:@"screenPadding" fallback:20.0];
  CGFloat footerHeight = [self layoutToken:@"buttonHeight" fallback:48.0] + 24.0;
  [NSLayoutConstraint activateConstraints:@[
    [content.topAnchor constraintEqualToAnchor:safe.topAnchor constant:10.0],
    [content.leadingAnchor constraintEqualToAnchor:overlay.leadingAnchor constant:horizontal],
    [content.trailingAnchor constraintEqualToAnchor:overlay.trailingAnchor constant:-horizontal],
    [content.bottomAnchor constraintEqualToAnchor:footer.topAnchor constant:-8.0],

    [footer.leadingAnchor constraintEqualToAnchor:overlay.leadingAnchor],
    [footer.trailingAnchor constraintEqualToAnchor:overlay.trailingAnchor],
    [footer.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor],
    [footer.heightAnchor constraintEqualToConstant:footerHeight],

    [badge.topAnchor constraintEqualToAnchor:content.topAnchor],
    [badge.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
    [badge.heightAnchor constraintEqualToConstant:24.0],
    [badge.widthAnchor constraintGreaterThanOrEqualToConstant:120.0],
    [badge.trailingAnchor constraintLessThanOrEqualToAnchor:content.trailingAnchor],

    [titleLabel.topAnchor constraintEqualToAnchor:badge.bottomAnchor constant:12.0],
    [titleLabel.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
    [titleLabel.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],

    [subtitleLabel.topAnchor constraintEqualToAnchor:titleLabel.bottomAnchor constant:8.0],
    [subtitleLabel.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
    [subtitleLabel.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],

    [card.topAnchor constraintEqualToAnchor:subtitleLabel.bottomAnchor constant:18.0],
    [card.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
    [card.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],

    [iconWrap.topAnchor constraintEqualToAnchor:card.topAnchor constant:16.0],
    [iconWrap.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:16.0],
    [iconWrap.widthAnchor constraintEqualToConstant:40.0],
    [iconWrap.heightAnchor constraintEqualToConstant:40.0],
    [terminalIcon.centerXAnchor constraintEqualToAnchor:iconWrap.centerXAnchor],
    [terminalIcon.centerYAnchor constraintEqualToAnchor:iconWrap.centerYAnchor],

    [messageTitle.topAnchor constraintEqualToAnchor:card.topAnchor constant:16.0],
    [messageTitle.leadingAnchor constraintEqualToAnchor:iconWrap.trailingAnchor constant:12.0],
    [messageTitle.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-16.0],
    [messageBody.topAnchor constraintEqualToAnchor:messageTitle.bottomAnchor constant:4.0],
    [messageBody.leadingAnchor constraintEqualToAnchor:messageTitle.leadingAnchor],
    [messageBody.trailingAnchor constraintEqualToAnchor:messageTitle.trailingAnchor],
    [messageBody.bottomAnchor constraintEqualToAnchor:card.bottomAnchor constant:-16.0],

    [stackLabelRow.topAnchor constraintEqualToAnchor:card.bottomAnchor constant:16.0],
    [stackLabelRow.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
    [stackLabelRow.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],
    [stackLabelRow.heightAnchor constraintEqualToConstant:16.0],

    [arrowIcon.leadingAnchor constraintEqualToAnchor:stackLabelRow.leadingAnchor],
    [arrowIcon.centerYAnchor constraintEqualToAnchor:stackLabelRow.centerYAnchor],
    [stackLabelTitle.leadingAnchor constraintEqualToAnchor:arrowIcon.trailingAnchor constant:4.0],
    [stackLabelTitle.centerYAnchor constraintEqualToAnchor:stackLabelRow.centerYAnchor],

    [stackScroll.topAnchor constraintEqualToAnchor:stackLabelRow.bottomAnchor constant:8.0],
    [stackScroll.leadingAnchor constraintEqualToAnchor:content.leadingAnchor],
    [stackScroll.trailingAnchor constraintEqualToAnchor:content.trailingAnchor],
    [stackScroll.bottomAnchor constraintEqualToAnchor:content.bottomAnchor],

    [stackBody.topAnchor constraintEqualToAnchor:stackScroll.topAnchor constant:10.0],
    [stackBody.leadingAnchor constraintEqualToAnchor:stackScroll.leadingAnchor constant:10.0],
    [stackBody.trailingAnchor constraintEqualToAnchor:stackScroll.trailingAnchor constant:-10.0],
    [stackBody.bottomAnchor constraintEqualToAnchor:stackScroll.bottomAnchor constant:-10.0],
    [stackBody.widthAnchor constraintEqualToAnchor:stackScroll.widthAnchor constant:-20.0],

    [dismissButton.leadingAnchor constraintEqualToAnchor:footer.leadingAnchor constant:horizontal],
    [dismissButton.centerYAnchor constraintEqualToAnchor:footer.centerYAnchor constant:-6.0],
    [dismissButton.heightAnchor constraintEqualToConstant:[self layoutToken:@"buttonHeight" fallback:48.0]],

    [reloadButton.leadingAnchor constraintEqualToAnchor:dismissButton.trailingAnchor constant:8.0],
    [reloadButton.trailingAnchor constraintEqualToAnchor:footer.trailingAnchor constant:-horizontal],
    [reloadButton.centerYAnchor constraintEqualToAnchor:dismissButton.centerYAnchor],
    [reloadButton.heightAnchor constraintEqualToAnchor:dismissButton.heightAnchor],
    [reloadButton.widthAnchor constraintEqualToAnchor:dismissButton.widthAnchor],
  ]];

  [self.fatalOverlay removeFromSuperview];
  self.fatalOverlay = overlay;
  [root addSubview:overlay];

  if (stack.length > 0) {
    [self requestSymbolicationForStack:stack label:stackBody stackView:stackScroll overlay:overlay];
  }
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
    UILayoutGuide *safe = root.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
      [toast.leadingAnchor constraintEqualToAnchor:root.leadingAnchor constant:[self layoutToken:@"screenPadding" fallback:20.0]],
      [toast.trailingAnchor constraintEqualToAnchor:root.trailingAnchor constant:-[self layoutToken:@"screenPadding" fallback:20.0]],
      [toast.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-12.0],
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

- (UIButton *)actionButtonWithGlyph:(NSString *)glyph
                              title:(NSString *)title
                              color:(UIColor *)color
                             action:(SEL)action {
  UIButton *button = [UIButton buttonWithType:UIButtonTypeCustom];
  button.backgroundColor = color;
  button.layer.cornerRadius = 16.0;
  [button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];

  UIStackView *stack = [[UIStackView alloc] init];
  stack.translatesAutoresizingMaskIntoConstraints = NO;
  stack.axis = UILayoutConstraintAxisHorizontal;
  stack.alignment = UIStackViewAlignmentCenter;
  stack.spacing = 6.0;
  [button addSubview:stack];

  UILabel *icon = [self glyphLabel:glyph color:[self colorToken:@"buttonText" fallback:@"#E4E4E7"] size:18.0];
  UILabel *label = [[UILabel alloc] init];
  label.text = title;
  label.textColor = [self colorToken:@"buttonText" fallback:@"#E4E4E7"];
  label.font = [UIFont systemFontOfSize:13 weight:UIFontWeightBold];

  [stack addArrangedSubview:icon];
  [stack addArrangedSubview:label];

  [NSLayoutConstraint activateConstraints:@[
    [stack.centerXAnchor constraintEqualToAnchor:button.centerXAnchor],
    [stack.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
  ]];

  return button;
}

- (UILabel *)glyphLabel:(NSString *)glyph color:(UIColor *)color size:(CGFloat)size {
  UILabel *label = [[UILabel alloc] init];
  label.text = glyph;
  label.textColor = color;
  label.font = [self glyphFont:size];
  label.textAlignment = NSTextAlignmentCenter;
  return label;
}

- (UIFont *)glyphFont:(CGFloat)size {
  UIFont *font = [UIFont fontWithName:@"ZynthRuntime" size:size];
  if (font) return font;
  return [UIFont systemFontOfSize:size weight:UIFontWeightRegular];
}

- (UIColor *)colorWithAlpha:(UIColor *)color alpha:(CGFloat)alpha {
  CGFloat r = 0, g = 0, b = 0, a = 0;
  [color getRed:&r green:&g blue:&b alpha:&a];
  return [UIColor colorWithRed:r green:g blue:b alpha:alpha];
}

- (NSAttributedString *)styledStackText:(NSString *)stack {
  NSString *base = stack.length > 0 ? stack : @"No stack trace available.";
  NSArray<NSString *> *lines = [base componentsSeparatedByString:@"\n"];
  NSMutableArray<NSString *> *displayLines = [NSMutableArray arrayWithCapacity:lines.count];
  for (NSUInteger i = 0; i < lines.count; i++) {
    NSString *line = lines[i];
    if (i == 0) {
      [displayLines addObject:line];
    } else {
      [displayLines addObject:[@"  " stringByAppendingString:line]];
    }
  }
  NSString *value = [displayLines componentsJoinedByString:@"\n"];
  UIColor *body = [self colorToken:@"body" fallback:@"#A1A1AA"];
  UIColor *title = [self colorToken:@"title" fallback:@"#FAFAFA"];
  UIFont *font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
  NSMutableAttributedString *attributed = [[NSMutableAttributedString alloc] initWithString:value
                                                                                  attributes:@{
    NSForegroundColorAttributeName: body,
    NSFontAttributeName: font,
  }];
  NSRange firstBreak = [value rangeOfString:@"\n"];
  NSUInteger firstLength = firstBreak.location == NSNotFound ? value.length : firstBreak.location;
  if (firstLength > 0) {
    [attributed addAttribute:NSForegroundColorAttributeName value:title range:NSMakeRange(0, firstLength)];
  }
  return attributed;
}

- (void)requestSymbolicationForStack:(NSString *)stack
                                label:(UILabel *)stackBody
                           stackView:(UIView *)stackView
                              overlay:(UIView *)overlay {
  Class symbolicator = NSClassFromString(@"ZynthStackSymbolicator");
  SEL selector = NSSelectorFromString(@"symbolicate:completion:");
  if (!symbolicator || ![symbolicator respondsToSelector:selector]) {
    NSLog(@"[ZynthSymbolicator] iOS symbolicator class unavailable");
    return;
  }
  NSLog(@"[ZynthSymbolicator] iOS symbolication requested");
  __weak typeof(self) weakSelf = self;
  __weak UILabel *weakStackBody = stackBody;
  void (*invoke)(id, SEL, NSString *, id) = (void (*)(id, SEL, NSString *, id))objc_msgSend;
  invoke(symbolicator, selector, stack, ^(NSString *symbolicated) {
    __strong typeof(self) strongSelf = weakSelf;
    UILabel *strongStackBody = weakStackBody;
    if (!strongSelf || !strongStackBody || strongSelf.fatalOverlay != overlay || !stackView) return;
    NSAttributedString *styled = [strongSelf styledStackText:symbolicated ?: @""];
    if ([strongStackBody.attributedText.string isEqualToString:styled.string]) return;
    [UIView animateWithDuration:0.12
                     animations:^{
                       stackView.alpha = 0.0;
                     }
                     completion:^(BOOL finished) {
                       if (!finished || strongSelf.fatalOverlay != overlay) return;
                       strongStackBody.attributedText = styled;
                       [UIView animateWithDuration:0.18
                                        animations:^{
                                          stackView.alpha = 1.0;
                                        }];
                     }];
  });
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
