#import "ZynthRecyclerScrollView.h"
#import "ZynthUIManager+Internal.h"

@interface ZynthScrollView ()
@property(nonatomic, assign) CGSize manualContentSize;
@property(nonatomic, assign) CGSize lastContentSize;
@property(nonatomic, assign) BOOL contentGeometryDirty;
@property(nonatomic, strong) UIScrollView *scrollView;
@property(nonatomic, strong) UIView *contentView;
@end

@implementation ZynthRecyclerScrollView

- (void)updateContentGeometry {
  self.contentGeometryDirty = NO;
  
  // Strictly use manual content size.
  // If not set (0,0), we default to the bounds size (non-scrollable).
  CGFloat w = MAX(self.manualContentSize.width, self.bounds.size.width);
  CGFloat h = MAX(self.manualContentSize.height, self.bounds.size.height);
  
  CGSize nextContentSize = CGSizeMake(w, h);
  
  // Always update content view frame
  self.contentView.frame = CGRectMake(0, 0, w, h);
  
  CGFloat epsilon = 0.5f;
  if (fabs(nextContentSize.width - self.lastContentSize.width) > epsilon ||
      fabs(nextContentSize.height - self.lastContentSize.height) > epsilon) {
    self.scrollView.contentSize = nextContentSize;
    self.lastContentSize = nextContentSize;
  }
}

// Override to ensure we don't accidentally use legacy logic
- (void)didAddSubview:(UIView *)subview {
  // Call super to handle normal insertion, but our updateContentGeometry ignores the view's frame
  [super didAddSubview:subview];
}

@end
