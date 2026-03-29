#import "ZynthTextInputContainer.h"

@implementation ZynthTextInputContainer {
    UIView *_inputView;
}

@synthesize inputView = _inputView;

- (instancetype)initWithInputView:(UIView *)inputView {
    self = [super initWithFrame:CGRectZero];
    if (self) {
        _inputView = inputView;
        [self addSubview:_inputView];
        _inputView.translatesAutoresizingMaskIntoConstraints = NO;
        [NSLayoutConstraint activateConstraints:@[
            [_inputView.topAnchor constraintEqualToAnchor:self.topAnchor],
            [_inputView.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
            [_inputView.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
            [_inputView.bottomAnchor constraintEqualToAnchor:self.bottomAnchor]
        ]];
    }
    return self;
}

- (void)layoutSubviews {
    [super layoutSubviews];
    _inputView.frame = self.bounds;
}

- (void)setInputHandlerWorkletId:(NSInteger)workletId {
    SEL selector = NSSelectorFromString(@"setInputHandlerWorkletId:");
    if ([_inputView respondsToSelector:selector]) {
        ((void (*)(id, SEL, NSInteger))[_inputView methodForSelector:selector])(_inputView, selector, workletId);
    }
}

- (void)setSyncSignalId:(NSInteger)syncSignalId {
    SEL selector = NSSelectorFromString(@"setSyncSignalId:");
    if ([_inputView respondsToSelector:selector]) {
        ((void (*)(id, SEL, NSInteger))[_inputView methodForSelector:selector])(_inputView, selector, syncSignalId);
    }
}

@end
