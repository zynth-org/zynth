#import "SNUIManager+Image.h"
#import "SNUIManager+Internal.h"

#ifdef __OBJC__
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>

static id SNImageParseJSON(NSString *json) {
  if (!json || json.length == 0) return nil;
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;
  NSError *error = nil;
  id value = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) return nil;
  if ([value isKindOfClass:[NSNull class]]) return nil;
  return value;
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

static BOOL SNImageIsImageNode(SNNode *node) {
  return node && [node.view isKindOfClass:[UIImageView class]];
}

static void SNImageApplyResizeMode(id value, SNNode *node, SNUIManager *manager) {
  if (!SNImageIsImageNode(node)) return;
  UIImageView *imageView = (UIImageView *)node.view;
  NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : @"";
  if ([mode isEqualToString:@"cover"]) {
    imageView.contentMode = UIViewContentModeScaleAspectFill;
  } else if ([mode isEqualToString:@"contain"]) {
    imageView.contentMode = UIViewContentModeScaleAspectFit;
  } else if ([mode isEqualToString:@"stretch"]) {
    imageView.contentMode = UIViewContentModeScaleToFill;
  } else if ([mode isEqualToString:@"center"]) {
    imageView.contentMode = UIViewContentModeCenter;
  } else {
    imageView.contentMode = UIViewContentModeScaleAspectFill;
  }
  [manager sn_markNeedsFlush];
}

static void SNImageApplyTintColor(id value, SNNode *node, SNUIManager *manager) {
  if (!SNImageIsImageNode(node)) return;

  UIImageView *imageView = (UIImageView *)node.view;
  UIColor *color = SNImageColorFromValue(value);
  node.imageTintColor = color;

  // Apply color as a CALayer filter instead of tintColor to blend with the image
  if (color) {
    // Create a color overlay layer that blends with the image
    CALayer *colorLayer = [CALayer layer];
    colorLayer.frame = imageView.bounds;
    colorLayer.backgroundColor = color.CGColor;
    
    // Use multiply blend mode to tint the image (allows image to show through)
    colorLayer.compositingFilter = @"multiplyBlendMode";
    colorLayer.name = @"tintColorLayer";
    
    // Remove any existing tint layer
    for (CALayer *sublayer in imageView.layer.sublayers.copy) {
      if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
        [sublayer removeFromSuperlayer];
      }
    }
    
    [imageView.layer addSublayer:colorLayer];
    
    // Ensure image uses original rendering mode
    if (imageView.image) {
      imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
    }
  } else {
    // Remove tint layer
    for (CALayer *sublayer in imageView.layer.sublayers.copy) {
      if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
        [sublayer removeFromSuperlayer];
      }
    }
    
    if (imageView.image) {
      imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
    }
  }
  [manager sn_markNeedsFlush];
}

static void SNImageApplyImage(UIImage * _Nullable image, SNNode *node, NSString *token, SNUIManager *manager) {
  if (!SNImageIsImageNode(node)) return;
  if (token.length == 0 || ![node.imageSourceToken isEqualToString:token]) {
    return;
  }

  UIImageView *imageView = (UIImageView *)node.view;

  if (!image) {
    imageView.image = nil;
    if (node.yoga && YGNodeHasMeasureFunc(node.yoga)) {
      if (YGNodeGetOwner(node.yoga)) {
        YGNodeMarkDirty(node.yoga);
      }
    }
    [manager sn_markNeedsFlush];
    return;
  }

  // Always use original rendering mode - tint is applied via layer
  UIImage *finalImage = [image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
  imageView.image = finalImage;
  
  // Reapply tint color if present
  if (node.imageTintColor) {
    // Update tint layer frame to match new image bounds
    for (CALayer *sublayer in imageView.layer.sublayers) {
      if ([sublayer.name isEqualToString:@"tintColorLayer"]) {
        sublayer.frame = imageView.bounds;
      }
    }
  }

  if (node.yoga && YGNodeHasMeasureFunc(node.yoga)) {
    if (YGNodeGetOwner(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
  }
  [manager sn_markNeedsFlush];

  NSDictionary *payload = @{ @"target": @(node.nid),
                              @"width": @(image.size.width),
                              @"height": @(image.size.height) };
  [manager sn_dispatchEvent:@"onLoad" payload:payload toNode:node];
}

static void SNImageEmitError(NSString *message, SNNode *node, SNUIManager *manager) {
  NSDictionary *payload = message.length > 0 ? @{ @"target": @(node.nid), @"message": message } : @{ @"target": @(node.nid) };
  [manager sn_dispatchEvent:@"onError" payload:payload toNode:node];
}

static void SNImageLoadBase64(NSString *data, id scaleValue, SNNode *node, NSString *token, SNUIManager *manager) {
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

static void SNImageLoadAsset(NSString *asset, id bundleValue, id scaleValue, SNNode *node, NSString *token, SNUIManager *manager) {
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
  UIImage *image = [UIImage imageNamed:asset inBundle:bundle compatibleWithTraitCollection:nil];
  if (!image) {
    SNImageEmitError([NSString stringWithFormat:@"Asset %@ not found", asset], node, manager);
    return;
  }
  if (scale > 0 && image.scale != scale) {
    image = [UIImage imageWithCGImage:image.CGImage scale:scale orientation:image.imageOrientation];
  }

  SNImageApplyImage(image, node, token, manager);
}

static void SNImageLoadSystem(NSString *name, SNNode *node, NSString *token, SNUIManager *manager) {
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

static void SNImageLoadURI(NSString *uri, NSDictionary * _Nullable info, SNNode *node, NSString *token, SNUIManager *manager) {
  NSString *lower = uri.lowercaseString;
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

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
  NSString *method = [info[@"method"] isKindOfClass:[NSString class]] ? info[@"method"] : nil;
  if (method.length > 0) {
    request.HTTPMethod = method;
  }
  NSDictionary *headers = [info[@"headers"] isKindOfClass:[NSDictionary class]] ? info[@"headers"] : nil;
  [headers enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
    if (![key isKindOfClass:[NSString class]] || ![obj isKindOfClass:[NSString class]]) return;
    [request setValue:obj forHTTPHeaderField:key];
  }];
  NSString *body = [info[@"body"] isKindOfClass:[NSString class]] ? info[@"body"] : nil;
  if (body.length > 0) {
    request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
  }

  __weak SNNode *weakNode = node;
  __weak SNUIManager *weakManager = manager;
  NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
                                                               completionHandler:^(NSData * _Nullable data,
                                                                                   NSURLResponse * _Nullable response,
                                                                                   NSError * _Nullable error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      SNNode *strongNode = weakNode;
      SNUIManager *strongManager = weakManager;
      if (!strongManager || !strongNode) return;
      if (![strongNode.imageSourceToken isEqualToString:token]) {
        return;
      }
      strongNode.imageTask = nil;
      if (error) {
        SNImageEmitError(error.localizedDescription ?: @"Image request failed", strongNode, strongManager);
        return;
      }
      if (!data) {
        SNImageEmitError(@"Image request returned no data", strongNode, strongManager);
        return;
      }
      UIImage *image = [UIImage imageWithData:data];
      if (!image) {
        SNImageEmitError(@"Unable to decode image data", strongNode, strongManager);
        return;
      }
      SNImageApplyImage(image, strongNode, token, strongManager);
    });
  }];

  node.imageTask = task;
  [task resume];
}

static void SNImageApplySourceValue(id value, SNNode *node, SNUIManager *manager) {
  if (node.imageTask) {
    [node.imageTask cancel];
    node.imageTask = nil;
  }

  node.imageSourceToken = SNImageNextToken();

  if (!value) {
    SNImageApplyImage(nil, node, node.imageSourceToken, manager);
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
    SNImageApplyImage(nil, node, node.imageSourceToken, manager);
    return;
  }

  if ([first isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)first;
    NSString *uri = dict[@"uri"];
    NSString *asset = dict[@"asset"];
    NSString *system = dict[@"system"];
    NSString *data = dict[@"data"];

    if (data.length > 0) {
      SNImageLoadBase64(data, dict[@"scale"], node, node.imageSourceToken, manager);
      return;
    }

    if (system.length > 0) {
      SNImageLoadSystem(system, node, node.imageSourceToken, manager);
      return;
    }

    if (asset.length > 0) {
      SNImageLoadAsset(asset, dict[@"bundle"], dict[@"scale"], node, node.imageSourceToken, manager);
      return;
    }

    if (uri.length > 0) {
      SNImageLoadURI(uri, dict, node, node.imageSourceToken, manager);
      return;
    }
  }

  if ([first isKindOfClass:[NSString class]]) {
    SNImageLoadURI(first, nil, node, node.imageSourceToken, manager);
    return;
  }

  SNImageEmitError(@"Unsupported image source", node, manager);
}

static BOOL RuneImageHandleSetProp(SNUIManager *manager,
                                   SNNode *node,
                                   NSString *name,
                                   id value,
                                   NSString *rawJSON) {
  if (!SNImageIsImageNode(node)) {
    return NO;
  }

  if ([name isEqualToString:@"source"]) {
    id parsedValue = SNImageParseJSON(rawJSON);
    SNImageApplySourceValue(parsedValue, node, manager);
    return YES;
  }

  if ([name isEqualToString:@"resizeMode"]) {
    id parsedValue = SNImageParseJSON(rawJSON);
    SNImageApplyResizeMode(parsedValue, node, manager);
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    id parsedValue = SNImageParseJSON(rawJSON);
    SNImageApplyTintColor(parsedValue, node, manager);
    return YES;
  }

  return NO;
}

static BOOL RuneImageHandleSetHandler(SNUIManager *manager,
                                      SNNode *node,
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

static void RuneImageCleanup(SNUIManager *manager, SNNode *node) {
  if (!SNImageIsImageNode(node)) {
    return;
  }

  if (node.imageTask) {
    [node.imageTask cancel];
    node.imageTask = nil;
  }
  node.imageSourceToken = nil;
  node.hasOnLoadHandler = NO;
  node.hasOnErrorHandler = NO;
  node.imageTintColor = nil;

  UIImageView *imageView = (UIImageView *)node.view;
  imageView.image = nil;
  imageView.tintColor = nil;

  [manager sn_storeEventPayload:nil forNode:node name:@"onLoad"];
  [manager sn_storeEventPayload:nil forNode:node name:@"onError"];
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

@implementation SNUIManager (ImageComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"image"];
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      UIImageView *imageView = [UIImageView new];
      imageView.clipsToBounds = YES;
      imageView.contentMode = UIViewContentModeScaleAspectFill;
      return imageView;
    };
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[UIImageView class]]) return;
      if (!node.yoga) return;
      YGNodeSetContext(node.yoga, (__bridge void *)node.view);
      YGNodeSetMeasureFunc(node.yoga, SNMeasureImageFunc);
    };
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneImageHandleSetProp(manager, node, name, value, rawJSON);
    };
    descriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneImageHandleSetHandler(manager, node, name);
    };
    descriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      RuneImageCleanup(manager, node);
    };
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end

#else

@implementation SNUIManager (ImageComponent)

+ (void)load {
}

@end

#endif // __has_include(<UIKit/UIKit.h>)
#endif
