#import "ZynthUIManager+Image.h"
#import "ZynthUIManager+Internal.h"
#import <SDWebImage/SDWebImage.h>

#ifdef __OBJC__
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>

@interface ZynthImageView : UIImageView
@end

@implementation ZynthImageView
- (void)layoutSubviews {
  [super layoutSubviews];
  self.clipsToBounds = YES;
  self.layer.masksToBounds = YES;
  for (CALayer *sublayer in self.layer.sublayers) {
    if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
      sublayer.frame = self.bounds;
      if (sublayer.mask) {
        sublayer.mask.frame = self.bounds;
      }
    }
  }
}
@end

static NSString *const kSNImageTaskKey = @"imageTask";
static NSString *const kSNImageSourceTokenKey = @"imageSourceToken";
static NSString *const kSNImageTintColorKey = @"imageTintColor";

static CGFloat SNImageClamp01(CGFloat value) {
  if (value < 0.0) return 0.0;
  if (value > 1.0) return 1.0;
  return value;
}

static id SNImageAttachment(ZynthNode *node, NSString *key) {
  if (!node || !key) return nil;
  return node.attachments[key];
}

static void SNImageSetAttachment(ZynthNode *node, NSString *key, id value) {
  if (!node || !key) return;
  if (value) {
    node.attachments[key] = value;
  } else {
    [node.attachments removeObjectForKey:key];
  }
}

static UIColor *SNImageColorFromHex(NSString *hex) {
  if (!hex || ![hex isKindOfClass:[NSString class]]) return nil;
  hex = [hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  if ([hex hasPrefix:@"#"]) {
    hex = [hex substringFromIndex:1];
  }
  
  unsigned int hexValue = 0;
  NSScanner *scanner = [NSScanner scannerWithString:hex];
  if (![scanner scanHexInt:&hexValue]) return nil;
  
  CGFloat r, g, b, a = 1.0;
  if (hex.length == 8) {
    a = ((hexValue >> 24) & 0xFF) / 255.0;
    r = ((hexValue >> 16) & 0xFF) / 255.0;
    g = ((hexValue >> 8) & 0xFF) / 255.0;
    b = (hexValue & 0xFF) / 255.0;
  } else if (hex.length == 6) {
    r = ((hexValue >> 16) & 0xFF) / 255.0;
    g = ((hexValue >> 8) & 0xFF) / 255.0;
    b = (hexValue & 0xFF) / 255.0;
  } else {
    return nil;
  }
  
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

static UIColor *SNImageColorFromValue(id value) {
  if ([value isKindOfClass:[NSString class]]) {
    NSString *str = (NSString *)value;
    
    // Check for rgba() format
    if ([str hasPrefix:@"rgba("]) {
      NSString *values = [str substringWithRange:NSMakeRange(5, str.length - 6)];
      NSArray *components = [values componentsSeparatedByString:@","];
      if (components.count == 4) {
        CGFloat r = [[components[0] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] floatValue] / 255.0;
        CGFloat g = [[components[1] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] floatValue] / 255.0;
        CGFloat b = [[components[2] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] floatValue] / 255.0;
        CGFloat a = [[components[3] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] floatValue];
        r = SNImageClamp01(r);
        g = SNImageClamp01(g);
        b = SNImageClamp01(b);
        a = SNImageClamp01(a);
        return [UIColor colorWithRed:r green:g blue:b alpha:a];
      }
    }
    
    // Fall back to hex color
    return SNImageColorFromHex(str);
  }
  return nil;
}

static NSString *SNImageNextToken(void) {
  return [[NSUUID UUID] UUIDString];
}

static BOOL SNImageIsImageNode(ZynthNode *node) {
  return node && [node.view isKindOfClass:[UIImageView class]];
}

static void SNImageApplyResizeMode(id value, ZynthNode *node, ZynthUIManager *manager) {
  if (!SNImageIsImageNode(node)) return;
  UIImageView *imageView = (UIImageView *)node.view;
  NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : @"";
  
  UIViewContentMode targetMode = UIViewContentModeScaleAspectFill;
  NSString *gravity = kCAGravityResizeAspectFill;
  
  if ([mode isEqualToString:@"cover"]) {
    targetMode = UIViewContentModeScaleAspectFill;
    gravity = kCAGravityResizeAspectFill;
  } else if ([mode isEqualToString:@"contain"]) {
    targetMode = UIViewContentModeScaleAspectFit;
    gravity = kCAGravityResizeAspect;
  } else if ([mode isEqualToString:@"stretch"]) {
    targetMode = UIViewContentModeScaleToFill;
    gravity = kCAGravityResize;
  } else if ([mode isEqualToString:@"center"]) {
    targetMode = UIViewContentModeCenter;
    gravity = kCAGravityCenter;
  }
  
  if (imageView.contentMode != targetMode) {
    imageView.contentMode = targetMode;
    [imageView setNeedsDisplay];
    
    // Update tint mask gravity
    for (CALayer *sublayer in imageView.layer.sublayers) {
      if ([sublayer.name isEqualToString:@"tintColorLayer"] && sublayer.mask) {
        sublayer.mask.contentsGravity = gravity;
      }
    }
  }
  
  [manager zynth_markNeedsFlush];
}

static void SNImageApplyTintColor(id value, ZynthNode *node, ZynthUIManager *manager) {
  if (!SNImageIsImageNode(node)) return;

  UIImageView *imageView = (UIImageView *)node.view;
  UIColor *color = SNImageColorFromValue(value);
  SNImageSetAttachment(node, kSNImageTintColorKey, color);

  imageView.tintColor = color; // Keep this for system behavior if needed

  // Remove existing tint layer
  CALayer *tintLayer = nil;
  for (CALayer *sublayer in imageView.layer.sublayers.copy) {
    if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
      tintLayer = sublayer;
      break;
    }
  }

  if (color && imageView.image) {
    if (!tintLayer) {
      tintLayer = [CALayer layer];
      tintLayer.name = @"tintColorLayer";
      tintLayer.frame = imageView.bounds;
      [imageView.layer addSublayer:tintLayer];
    }
    
    tintLayer.backgroundColor = color.CGColor;
    
    // Create or update mask to match image
    CALayer *maskLayer = tintLayer.mask;
    if (!maskLayer) {
      maskLayer = [CALayer layer];
      maskLayer.frame = tintLayer.bounds;
      tintLayer.mask = maskLayer;
    }
    
    maskLayer.contents = (id)imageView.image.CGImage;
    
    // Match gravity
    switch (imageView.contentMode) {
      case UIViewContentModeScaleAspectFit:
        maskLayer.contentsGravity = kCAGravityResizeAspect;
        break;
      case UIViewContentModeScaleToFill:
        maskLayer.contentsGravity = kCAGravityResize;
        break;
      case UIViewContentModeCenter:
        maskLayer.contentsGravity = kCAGravityCenter;
        break;
      case UIViewContentModeScaleAspectFill:
      default:
        maskLayer.contentsGravity = kCAGravityResizeAspectFill;
        break;
    }
    
    // Ensure image uses original rendering mode so it shows through transparent tint
    imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
    
  } else {
    [tintLayer removeFromSuperlayer];
    if (imageView.image) {
      imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
    }
  }
  
  [manager zynth_markNeedsFlush];
}

static void SNImageApplyImage(UIImage * _Nullable image, ZynthNode *node, NSString *token, ZynthUIManager *manager) {
  if (!SNImageIsImageNode(node)) return;
  NSString *currentToken = SNImageAttachment(node, kSNImageSourceTokenKey);
  if (token.length == 0 || ![currentToken isKindOfClass:[NSString class]] ||
      ![currentToken isEqualToString:token]) {
    return;
  }

  UIImageView *imageView = (UIImageView *)node.view;

  if (!image) {
    imageView.image = nil;
    // Remove tint layer if no image
    for (CALayer *sublayer in imageView.layer.sublayers.copy) {
        if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
            [sublayer removeFromSuperlayer];
        }
    }
    if (node.yoga && YGNodeHasMeasureFunc(node.yoga)) {
      if (YGNodeGetOwner(node.yoga)) {
        YGNodeMarkDirty(node.yoga);
      }
    }
    [manager zynth_markNeedsFlush];
    return;
  }

  // Always use original rendering mode
  imageView.image = [image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
  
  // Reapply tint color if present
  UIColor *tintColor = SNImageAttachment(node, kSNImageTintColorKey);
  if (tintColor) {
      // Reuse logic from ApplyTintColor to ensure layer/mask consistency
      SNImageApplyTintColor(node.attachments[kSNImageTintColorKey] /* pass raw color obj if needed, but here we invoke logic manually or refactor. */, node, manager);
      
      // Since ApplyTintColor expects 'id value' which might be a string, let's just do the layer update directly here:
      CALayer *tintLayer = nil;
      for (CALayer *sublayer in imageView.layer.sublayers) {
          if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
              tintLayer = sublayer;
              break;
          }
      }
      
      if (!tintLayer) {
          tintLayer = [CALayer layer];
          tintLayer.name = @"tintColorLayer";
          tintLayer.frame = imageView.bounds;
          tintLayer.backgroundColor = tintColor.CGColor;
          [imageView.layer addSublayer:tintLayer];
      }
      
      CALayer *maskLayer = tintLayer.mask;
      if (!maskLayer) {
          maskLayer = [CALayer layer];
          maskLayer.frame = tintLayer.bounds;
          tintLayer.mask = maskLayer;
      }
      maskLayer.contents = (id)image.CGImage;
       switch (imageView.contentMode) {
        case UIViewContentModeScaleAspectFit:
          maskLayer.contentsGravity = kCAGravityResizeAspect;
          break;
        case UIViewContentModeScaleToFill:
          maskLayer.contentsGravity = kCAGravityResize;
          break;
        case UIViewContentModeCenter:
          maskLayer.contentsGravity = kCAGravityCenter;
          break;
        case UIViewContentModeScaleAspectFill:
        default:
          maskLayer.contentsGravity = kCAGravityResizeAspectFill;
          break;
      }
  }

  if (node.yoga && YGNodeHasMeasureFunc(node.yoga)) {
    if (YGNodeGetOwner(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
  }
  [manager zynth_markNeedsFlush];

  NSDictionary *payload = @{ @"target": @(node.nid),
                              @"width": @(image.size.width),
                              @"height": @(image.size.height) };
  [manager zynth_dispatchEvent:@"onLoad" payload:payload toNode:node];
}

static void SNImageEmitError(NSString *message, ZynthNode *node, ZynthUIManager *manager) {
  NSDictionary *payload = message.length > 0 ? @{ @"target": @(node.nid), @"message": message } : @{ @"target": @(node.nid) };
  [manager zynth_dispatchEvent:@"onError" payload:payload toNode:node];
}

static BOOL SNImageIsSVGSource(NSString *uri) {
  if (uri.length == 0) return NO;
  NSString *lower = uri.lowercaseString;
  if ([lower hasPrefix:@"data:image/svg+xml"]) {
    return YES;
  }

  NSURLComponents *components = [NSURLComponents componentsWithString:uri];
  NSString *path = components.path ?: uri;
  NSString *ext = path.pathExtension.lowercaseString;
  return [ext isEqualToString:@"svg"] || [ext isEqualToString:@"svgz"];
}

static void SNImageLoadBase64(NSString *data, id scaleValue, ZynthNode *node, NSString *token, ZynthUIManager *manager) {
  NSString *payload = data;
  NSRange comma = [payload rangeOfString:@","];
  if (comma.location != NSNotFound) {
    payload = [payload substringFromIndex:comma.location + 1];
  }

  NSData *decoded = [[NSData alloc] initWithBase64EncodedString:payload options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (!decoded) {
    SNImageEmitError(@"Failed to decode image data", node, manager);
    return;
  }

  CGFloat scale = 0;
  if ([scaleValue respondsToSelector:@selector(doubleValue)]) {
    scale = (CGFloat)[scaleValue doubleValue];
  }
  if (scale <= 0) {
    scale = UIScreen.mainScreen.scale;
  }

  UIImage *image = [UIImage imageWithData:decoded scale:scale];
  if (!image) {
    SNImageEmitError(@"Unable to create image from data", node, manager);
    return;
  }

  SNImageApplyImage(image, node, token, manager);
}

static void SNImageLoadAsset(NSString *asset, id bundleValue, id scaleValue, ZynthNode *node, NSString *token, ZynthUIManager *manager) {
  NSBundle *bundle = [NSBundle mainBundle];
  if ([bundleValue isKindOfClass:[NSString class]]) {
    NSString *bundlePath = [[NSBundle mainBundle] pathForResource:bundleValue ofType:nil];
    if (bundlePath) {
      NSBundle *candidate = [NSBundle bundleWithPath:bundlePath];
      if (candidate) {
        bundle = candidate;
      }
    }
  }

  CGFloat scale = 0;
  if ([scaleValue respondsToSelector:@selector(doubleValue)]) {
    scale = (CGFloat)[scaleValue doubleValue];
  }
  UIImage *image = nil;
  NSString *resourcePath = bundle.resourcePath;
  NSString *fileName = asset.lastPathComponent;
  NSArray<NSString *> *pathCandidates = fileName.length > 0 && ![fileName isEqualToString:asset]
    ? @[asset, fileName]
    : @[asset];

  if (resourcePath.length > 0) {
    NSFileManager *fileManager = [NSFileManager defaultManager];
    for (NSString *candidate in pathCandidates) {
      NSString *assetPath = [resourcePath stringByAppendingPathComponent:candidate];
      if ([fileManager fileExistsAtPath:assetPath]) {
        image = [UIImage imageWithContentsOfFile:assetPath];
        if (image) break;
      }
    }
  }

  if (!image) {
    for (NSString *candidate in pathCandidates) {
      if ([candidate rangeOfString:@"/"].location != NSNotFound) {
        continue;
      }
      image = [UIImage imageNamed:candidate inBundle:bundle compatibleWithTraitCollection:nil];
      if (image) break;
    }
  }
  if (!image) {
    SNImageEmitError([NSString stringWithFormat:@"Asset %@ not found", asset], node, manager);
    return;
  }
  if (scale > 0 && image.scale != scale) {
    image = [UIImage imageWithCGImage:image.CGImage scale:scale orientation:image.imageOrientation];
  }

  SNImageApplyImage(image, node, token, manager);
}

static void SNImageLoadSystem(NSString *name, ZynthNode *node, NSString *token, ZynthUIManager *manager) {
  NSLog(@"[SNImageLoadSystem] Loading system icon: '%@'", name);
  if (@available(iOS 13.0, *)) {
    UIImage *image = [UIImage systemImageNamed:name];
    if (!image) {
      NSLog(@"[SNImageLoadSystem] Failed to find system icon: '%@'", name);
      SNImageEmitError([NSString stringWithFormat:@"System image %@ not found", name], node, manager);
      return;
    }
    SNImageApplyImage(image, node, token, manager);
  } else {
    SNImageEmitError(@"System images require iOS 13+", node, manager);
  }
}

static void SNImageLoadURI(NSString *uri, NSDictionary * _Nullable info, ZynthNode *node, NSString *token, ZynthUIManager *manager) {
  NSString *lower = uri.lowercaseString;
  if (SNImageIsSVGSource(uri)) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      NSLog(@"[ZynthImage] SVG source detected but SVG is not supported on iOS Image anymore.");
    });
    SNImageEmitError(@"SVG is not supported on iOS Image. Use PNG/JPEG/WebP or render SVG another way.", node, manager);
    return;
  }

  if ([lower hasPrefix:@"data:"]) {
    SNImageLoadBase64(uri, info[@"scale"], node, token, manager);
    return;
  }

  if ([lower hasPrefix:@"file:"]) {
    NSURL *fileURL = [NSURL URLWithString:uri];
    if (!fileURL) {
      SNImageEmitError(@"Invalid file URI", node, manager);
      return;
    }
    NSData *data = [NSData dataWithContentsOfURL:fileURL];
    if (!data) {
      SNImageEmitError(@"Unable to read file", node, manager);
      return;
    }
    UIImage *image = [UIImage imageWithData:data];
    if (!image) {
      SNImageEmitError(@"Unable to decode file image", node, manager);
      return;
    }
    SNImageApplyImage(image, node, token, manager);
    return;
  }

  if (![lower hasPrefix:@"http"]) {
    if ([uri hasPrefix:@"/"]) {
      UIImage *image = [UIImage imageWithContentsOfFile:uri];
      if (!image) {
        SNImageEmitError([NSString stringWithFormat:@"Image at %@ not found", uri], node, manager);
        return;
      }
      SNImageApplyImage(image, node, token, manager);
      return;
    }
    UIImage *image = [UIImage imageNamed:uri];
    if (!image) {
      SNImageEmitError([NSString stringWithFormat:@"Image %@ not found", uri], node, manager);
      return;
    }
    SNImageApplyImage(image, node, token, manager);
    return;
  }

  NSURL *url = [NSURL URLWithString:uri];
  if (!url) {
    SNImageEmitError(@"Invalid image URL", node, manager);
    return;
  }

  SDWebImageContext *context = nil;
  
  NSDictionary *headers = [info[@"headers"] isKindOfClass:[NSDictionary class]] ? info[@"headers"] : nil;
  if (headers.count > 0) {
      SDWebImageDownloaderRequestModifier *modifier = [SDWebImageDownloaderRequestModifier requestModifierWithBlock:^NSURLRequest * _Nullable(NSURLRequest * _Nonnull request) {
          NSMutableURLRequest *mutableRequest = [request mutableCopy];
          for (NSString *key in headers) {
              id val = headers[key];
              if ([val isKindOfClass:[NSString class]]) {
                  [mutableRequest setValue:(NSString *)val forHTTPHeaderField:key];
              }
          }
          return mutableRequest;
      }];
      context = @{SDWebImageContextDownloadRequestModifier: modifier};
  }

  __weak ZynthNode *weakNode = node;
  __weak ZynthUIManager *weakManager = manager;
  
  id<SDWebImageOperation> operation = [[SDWebImageManager sharedManager] loadImageWithURL:url
                                                   options:SDWebImageRetryFailed
                                                   context:context
                                                  progress:nil
                                                 completed:^(UIImage * _Nullable image, NSData * _Nullable data, NSError * _Nullable error, SDImageCacheType cacheType, BOOL finished, NSURL * _Nullable imageURL) {
    dispatch_async(dispatch_get_main_queue(), ^{
      ZynthNode *strongNode = weakNode;
      ZynthUIManager *strongManager = weakManager;
      if (!strongManager || !strongNode) return;
      NSString *strongToken = SNImageAttachment(strongNode, kSNImageSourceTokenKey);
      if (![strongToken isKindOfClass:[NSString class]] || ![strongToken isEqualToString:token]) {
        return;
      }
      // Only clear task if finished
      if (finished) {
          SNImageSetAttachment(strongNode, kSNImageTaskKey, nil);
      }
      
      if (error) {
        SNImageEmitError(error.localizedDescription ?: @"Image request failed", strongNode, strongManager);
        return;
      }
      if (!image && finished) {
        SNImageEmitError(@"Image request returned no data", strongNode, strongManager);
        return;
      }
      if (image) {
          // Re-apply to ensure proper sizing/event dispatch
          SNImageApplyImage(image, strongNode, token, strongManager);
      }
    });
  }];

  SNImageSetAttachment(node, kSNImageTaskKey, operation);
}

static void SNImageApplySourceValue(id value, ZynthNode *node, ZynthUIManager *manager) {
  id<SDWebImageOperation> existing = SNImageAttachment(node, kSNImageTaskKey);
  if (existing) {
    [existing cancel];
    SNImageSetAttachment(node, kSNImageTaskKey, nil);
  }

  NSString *token = SNImageNextToken();
  SNImageSetAttachment(node, kSNImageSourceTokenKey, token);

  if (!value) {
    SNImageApplyImage(nil, node, token, manager);
    return;
  }

  NSArray *candidates = nil;
  if ([value isKindOfClass:[NSArray class]]) {
    candidates = value;
  } else {
    candidates = @[value];
  }

  id first = candidates.firstObject;
  if (!first || [first isKindOfClass:[NSNull class]]) {
    SNImageApplyImage(nil, node, token, manager);
    return;
  }

  if ([first isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)first;
    NSString *uri = dict[@"uri"];
    NSString *asset = dict[@"asset"];
    NSString *system = dict[@"system"];
    NSString *data = dict[@"data"];

    if (data.length > 0) {
      SNImageLoadBase64(data, dict[@"scale"], node, token, manager);
      return;
    }

    if (system.length > 0) {
      SNImageLoadSystem(system, node, token, manager);
      return;
    }

    if (asset.length > 0) {
      SNImageLoadAsset(asset, dict[@"bundle"], dict[@"scale"], node, token, manager);
      return;
    }

    if (uri.length > 0) {
      SNImageLoadURI(uri, dict, node, token, manager);
      return;
    }
  }

  if ([first isKindOfClass:[NSString class]]) {
    SNImageLoadURI(first, nil, node, token, manager);
    return;
  }

  SNImageEmitError(@"Unsupported image source", node, manager);
}

static BOOL ZynthImageHandleSetProp(ZynthUIManager *manager,
                                   ZynthNode *node,
                                   NSString *name,
                                   id value,
                                   NSString *rawJSON) {
  if (!SNImageIsImageNode(node)) {
    return NO;
  }

  if ([name isEqualToString:@"source"]) {
    // value is already parsed by ZynthUIManager if it's JSON
    SNImageApplySourceValue(value, node, manager);
    return YES;
  }

  if ([name isEqualToString:@"resizeMode"]) {
    SNImageApplyResizeMode(value, node, manager);
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    SNImageApplyTintColor(value, node, manager);
    return YES;
  }

  return NO;
}

static BOOL ZynthImageHandleSetHandler(ZynthUIManager *manager,
                                      ZynthNode *node,
                                      NSString *name) {
  if (!SNImageIsImageNode(node)) {
    return NO;
  }

  if ([name isEqualToString:@"onLoad"]) {
    node.hasOnLoadHandler = YES;
    return YES;
  }

  if ([name isEqualToString:@"onError"]) {
    node.hasOnErrorHandler = YES;
    return YES;
  }

  return NO;
}

static void ZynthImageCleanup(ZynthUIManager *manager, ZynthNode *node) {
  if (!SNImageIsImageNode(node)) {
    return;
  }

  id<SDWebImageOperation> task = SNImageAttachment(node, kSNImageTaskKey);
  if (task) {
    [task cancel];
    SNImageSetAttachment(node, kSNImageTaskKey, nil);
  }
  SNImageSetAttachment(node, kSNImageSourceTokenKey, nil);
  node.hasOnLoadHandler = NO;
  node.hasOnErrorHandler = NO;
  SNImageSetAttachment(node, kSNImageTintColorKey, nil);

  UIImageView *imageView = (UIImageView *)node.view;
  imageView.image = nil;
  imageView.tintColor = nil;

  [manager zynth_storeEventPayload:nil forNode:node name:@"onLoad"];
  [manager zynth_storeEventPayload:nil forNode:node name:@"onError"];
}

static YGSize SNMeasureImageFunc(YGNodeConstRef yogaNode,
                                 float width,
                                 YGMeasureMode widthMode,
                                 float height,
                                 YGMeasureMode heightMode) {
  UIImageView *imageView = (__bridge UIImageView *)YGNodeGetContext(yogaNode);
  if (![imageView isKindOfClass:[UIImageView class]]) {
    return (YGSize){.width = 1, .height = 1};
  }
  
  UIImage *image = imageView.image;
  CGFloat intrinsicWidth = 1;
  CGFloat intrinsicHeight = 1;
  
  if (image) {
    intrinsicWidth = image.size.width;
    intrinsicHeight = image.size.height;
  }
  
  CGFloat outW;
  switch (widthMode) {
    case YGMeasureModeExactly:
      outW = isnan(width) ? intrinsicWidth : width;
      break;
    case YGMeasureModeAtMost:
      if (isnan(width)) {
        outW = intrinsicWidth;
      } else {
        outW = MIN(width, intrinsicWidth);
      }
      break;
    case YGMeasureModeUndefined:
    default:
      outW = intrinsicWidth;
      break;
  }
  
  CGFloat outH;
  switch (heightMode) {
    case YGMeasureModeExactly:
      outH = isnan(height) ? intrinsicHeight : height;
      break;
    case YGMeasureModeAtMost:
      if (isnan(height)) {
        outH = intrinsicHeight;
      } else {
        outH = MIN(height, intrinsicHeight);
      }
      break;
    case YGMeasureModeUndefined:
    default:
      outH = intrinsicHeight;
      break;
  }
  
  return (YGSize){.width = MAX(1, outW), .height = MAX(1, outH)};
}

@implementation ZynthUIManager (ImageComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"image"];
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      UIImageView *imageView = [ZynthImageView new];
      imageView.clipsToBounds = YES;
      imageView.contentMode = UIViewContentModeScaleAspectFill;
      return imageView;
    };
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[UIImageView class]]) return;
      if (!node.yoga) return;
      YGNodeSetContext(node.yoga, (__bridge void *)node.view);
      YGNodeSetMeasureFunc(node.yoga, SNMeasureImageFunc);
    };
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthImageHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return ZynthImageHandleSetHandler(manager, node, name);
    };
    descriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      ZynthImageCleanup(manager, node);
    };
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end

#else

@implementation ZynthUIManager (ImageComponent)

+ (void)load {
}

@end

#endif // __has_include(<UIKit/UIKit.h>)
#endif
