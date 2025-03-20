#import "SNUIManager+Image.h"
#import "SNHexColor.h"

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

static UIColor *SNImageColorFromValue(id value) {
  if ([value isKindOfClass:[NSString class]]) {
    return SNColorFromHex(value);
  }
  return nil;
}

static NSString *SNImageNextToken(void) {
  return [[NSUUID UUID] UUIDString];
}

@interface SNUIManager (ImagePrivate)
- (BOOL)sn_imageIsImageNode:(SNNode *)node;
- (void)sn_imageApplySourceValue:(id)value toNode:(SNNode *)node;
- (void)sn_imageApplyResizeMode:(id)value toNode:(SNNode *)node;
- (void)sn_imageApplyTintColor:(id)value toNode:(SNNode *)node;
- (void)sn_imageApplyImage:(UIImage * _Nullable)image toNode:(SNNode *)node token:(NSString *)token;
- (void)sn_imageEmitError:(NSString *)message node:(SNNode *)node;
- (void)sn_imageLoadBase64:(NSString *)data scale:(id)scaleValue node:(SNNode *)node token:(NSString *)token;
- (void)sn_imageLoadAsset:(NSString *)asset bundle:(id)bundleValue scale:(id)scaleValue node:(SNNode *)node token:(NSString *)token;
- (void)sn_imageLoadURI:(NSString *)uri info:(NSDictionary * _Nullable)info node:(SNNode *)node token:(NSString *)token;
@end

@implementation SNUIManager (Image)

- (BOOL)sn_imageIsImageNode:(SNNode *)node {
  return node && [node.view isKindOfClass:[UIImageView class]];
}

- (BOOL)sn_imageHandlesSetPropForNode:(SNNode *)node
                                 name:(NSString *)name
                             valueJSON:(NSString *)json {
  if (![self sn_imageIsImageNode:node]) {
    return NO;
  }

  if ([name isEqualToString:@"source"]) {
    id value = SNImageParseJSON(json);
    [self sn_imageApplySourceValue:value toNode:node];
    return YES;
  }

  if ([name isEqualToString:@"resizeMode"]) {
    id value = SNImageParseJSON(json);
    [self sn_imageApplyResizeMode:value toNode:node];
    return YES;
  }

  if ([name isEqualToString:@"tintColor"]) {
    id value = SNImageParseJSON(json);
    [self sn_imageApplyTintColor:value toNode:node];
    return YES;
  }

  return NO;
}

- (BOOL)sn_imageHandlesSetPropCallbackForNode:(SNNode *)node
                                        name:(NSString *)name
                                     callback:(JSValue * _Nullable)callback {
  if (![self sn_imageIsImageNode:node]) {
    return NO;
  }

  BOOL isValidCallback = callback && ![callback isUndefined] && ![callback isNull];

  if ([name isEqualToString:@"onLoad"]) {
    node.onLoadCallback = isValidCallback ? callback : nil;
    if (isValidCallback) {
      node.hasOnLoadHandler = YES;
    } else if (!self.jsInvoker) {
      node.hasOnLoadHandler = NO;
    }
    return YES;
  }

  if ([name isEqualToString:@"onError"]) {
    node.onErrorCallback = isValidCallback ? callback : nil;
    if (isValidCallback) {
      node.hasOnErrorHandler = YES;
    } else if (!self.jsInvoker) {
      node.hasOnErrorHandler = NO;
    }
    return YES;
  }

  return NO;
}

- (BOOL)sn_imageHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
  if (![self sn_imageIsImageNode:node]) {
    return NO;
  }

  if ([name isEqualToString:@"onLoad"]) {
    node.onLoadCallback = nil;
    node.hasOnLoadHandler = YES;
    return YES;
  }

  if ([name isEqualToString:@"onError"]) {
    node.onErrorCallback = nil;
    node.hasOnErrorHandler = YES;
    return YES;
  }

  return NO;
}

- (void)sn_imageCleanupNode:(SNNode *)node {
  if (![self sn_imageIsImageNode:node]) {
    return;
  }

  if (node.imageTask) {
    [node.imageTask cancel];
    node.imageTask = nil;
  }
  node.imageSourceToken = nil;
  node.hasOnLoadHandler = NO;
  node.hasOnErrorHandler = NO;
  node.onLoadCallback = nil;
  node.onErrorCallback = nil;
  node.imageTintColor = nil;

  UIImageView *imageView = (UIImageView *)node.view;
  imageView.image = nil;
  imageView.tintColor = nil;

  [self sn_storeEventPayload:nil forNode:node name:@"onLoad"];
  [self sn_storeEventPayload:nil forNode:node name:@"onError"];
}

#pragma mark - Helpers

- (void)sn_imageApplySourceValue:(id)value toNode:(SNNode *)node {
  if (node.imageTask) {
    [node.imageTask cancel];
    node.imageTask = nil;
  }

  node.imageSourceToken = SNImageNextToken();

  if (!value) {
    [self sn_imageApplyImage:nil toNode:node token:node.imageSourceToken];
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
    [self sn_imageApplyImage:nil toNode:node token:node.imageSourceToken];
    return;
  }

  if ([first isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)first;
    NSString *uri = dict[@"uri"];
    NSString *asset = dict[@"asset"];
    NSString *data = dict[@"data"];

    if (data.length > 0) {
      [self sn_imageLoadBase64:data scale:dict[@"scale"] node:node token:node.imageSourceToken];
      return;
    }

    if (asset.length > 0) {
      [self sn_imageLoadAsset:asset bundle:dict[@"bundle"] scale:dict[@"scale"] node:node token:node.imageSourceToken];
      return;
    }

    if (uri.length > 0) {
      [self sn_imageLoadURI:uri info:dict node:node token:node.imageSourceToken];
      return;
    }
  }

  if ([first isKindOfClass:[NSString class]]) {
    [self sn_imageLoadURI:first info:nil node:node token:node.imageSourceToken];
    return;
  }

  [self sn_imageEmitError:@"Unsupported image source" node:node];
}

- (void)sn_imageApplyResizeMode:(id)value toNode:(SNNode *)node {
  if (![self sn_imageIsImageNode:node]) return;
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
  [self sn_markNeedsFlush];
}

- (void)sn_imageApplyTintColor:(id)value toNode:(SNNode *)node {
  if (![self sn_imageIsImageNode:node]) return;

  UIImageView *imageView = (UIImageView *)node.view;
  UIColor *color = SNImageColorFromValue(value);
  node.imageTintColor = color;

  if (color) {
    imageView.tintColor = color;
    if (imageView.image) {
      imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
    }
  } else {
    imageView.tintColor = nil;
    if (imageView.image) {
      imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
    }
  }
  [self sn_markNeedsFlush];
}

- (void)sn_imageApplyImage:(UIImage * _Nullable)image toNode:(SNNode *)node token:(NSString *)token {
  if (![self sn_imageIsImageNode:node]) return;
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
    [self sn_markNeedsFlush];
    return;
  }

  UIImage *finalImage = image;
  if (node.imageTintColor) {
    imageView.tintColor = node.imageTintColor;
    finalImage = [image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
  } else {
    finalImage = [image imageWithRenderingMode:UIImageRenderingModeAlwaysOriginal];
  }

  imageView.image = finalImage;

  if (node.yoga && YGNodeHasMeasureFunc(node.yoga)) {
    if (YGNodeGetOwner(node.yoga)) {
      YGNodeMarkDirty(node.yoga);
    }
  }
  [self sn_markNeedsFlush];

  NSDictionary *payload = @{ @"target": @(node.nid),
                              @"width": @(image.size.width),
                              @"height": @(image.size.height) };
  [self sn_dispatchEvent:@"onLoad" payload:payload toNode:node];
}

- (void)sn_imageEmitError:(NSString *)message node:(SNNode *)node {
  NSDictionary *payload = message.length > 0 ? @{ @"target": @(node.nid), @"message": message } : @{ @"target": @(node.nid) };
  [self sn_dispatchEvent:@"onError" payload:payload toNode:node];
}

- (void)sn_imageLoadBase64:(NSString *)data
                      scale:(id)scaleValue
                       node:(SNNode *)node
                      token:(NSString *)token {
  NSString *payload = data;
  NSRange comma = [payload rangeOfString:@","];
  if (comma.location != NSNotFound) {
    payload = [payload substringFromIndex:comma.location + 1];
  }

  NSData *decoded = [[NSData alloc] initWithBase64EncodedString:payload options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (!decoded) {
    [self sn_imageEmitError:@"Failed to decode image data" node:node];
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
    [self sn_imageEmitError:@"Unable to create image from data" node:node];
    return;
  }

  [self sn_imageApplyImage:image toNode:node token:token];
}

- (void)sn_imageLoadAsset:(NSString *)asset
                    bundle:(id)bundleValue
                     scale:(id)scaleValue
                      node:(SNNode *)node
                     token:(NSString *)token {
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
    [self sn_imageEmitError:[NSString stringWithFormat:@"Asset %@ not found", asset] node:node];
    return;
  }
  if (scale > 0 && image.scale != scale) {
    image = [UIImage imageWithCGImage:image.CGImage scale:scale orientation:image.imageOrientation];
  }

  [self sn_imageApplyImage:image toNode:node token:token];
}

- (void)sn_imageLoadURI:(NSString *)uri
                    info:(NSDictionary * _Nullable)info
                    node:(SNNode *)node
                   token:(NSString *)token {
  NSString *lower = uri.lowercaseString;
  if ([lower hasPrefix:@"data:"]) {
    [self sn_imageLoadBase64:uri scale:info[@"scale"] node:node token:token];
    return;
  }

  if ([lower hasPrefix:@"file:"]) {
    NSURL *fileURL = [NSURL URLWithString:uri];
    if (!fileURL) {
      [self sn_imageEmitError:@"Invalid file URI" node:node];
      return;
    }
    NSData *data = [NSData dataWithContentsOfURL:fileURL];
    if (!data) {
      [self sn_imageEmitError:@"Unable to read file" node:node];
      return;
    }
    UIImage *image = [UIImage imageWithData:data];
    if (!image) {
      [self sn_imageEmitError:@"Unable to decode file image" node:node];
      return;
    }
    [self sn_imageApplyImage:image toNode:node token:token];
    return;
  }

  if (![lower hasPrefix:@"http"]) {
    if ([uri hasPrefix:@"/"]) {
      UIImage *image = [UIImage imageWithContentsOfFile:uri];
      if (!image) {
        [self sn_imageEmitError:[NSString stringWithFormat:@"Image at %@ not found", uri] node:node];
        return;
      }
      [self sn_imageApplyImage:image toNode:node token:token];
      return;
    }
    UIImage *image = [UIImage imageNamed:uri];
    if (!image) {
      [self sn_imageEmitError:[NSString stringWithFormat:@"Image %@ not found", uri] node:node];
      return;
    }
    [self sn_imageApplyImage:image toNode:node token:token];
    return;
  }

  NSURL *url = [NSURL URLWithString:uri];
  if (!url) {
    [self sn_imageEmitError:@"Invalid image URL" node:node];
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

  __weak typeof(self) weakSelf = self;
  __weak SNNode *weakNode = node;
  NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
                                                               completionHandler:^(NSData * _Nullable data,
                                                                                   NSURLResponse * _Nullable response,
                                                                                   NSError * _Nullable error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) strongSelf = weakSelf;
      SNNode *strongNode = weakNode;
      if (!strongSelf || !strongNode) return;
      if (![strongNode.imageSourceToken isEqualToString:token]) {
        return;
      }
      strongNode.imageTask = nil;
      if (error) {
        [strongSelf sn_imageEmitError:error.localizedDescription ?: @"Image request failed" node:strongNode];
        return;
      }
      if (!data) {
        [strongSelf sn_imageEmitError:@"Image request returned no data" node:strongNode];
        return;
      }
      UIImage *image = [UIImage imageWithData:data];
      if (!image) {
        [strongSelf sn_imageEmitError:@"Unable to decode image data" node:strongNode];
        return;
      }
      [strongSelf sn_imageApplyImage:image toNode:strongNode token:token];
    });
  }];

  node.imageTask = task;
  [task resume];
}

@end

#else

@implementation SNUIManager (Image)

- (BOOL)sn_imageHandlesSetPropForNode:(SNNode *)node
                                 name:(NSString *)name
                             valueJSON:(NSString *)json {
  return NO;
}

- (BOOL)sn_imageHandlesSetPropCallbackForNode:(SNNode *)node
                                        name:(NSString *)name
                                     callback:(JSValue * _Nullable)callback {
  return NO;
}

- (BOOL)sn_imageHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name {
  return NO;
}

- (void)sn_imageCleanupNode:(SNNode *)node {}

@end

#endif // __has_include(<UIKit/UIKit.h>)
#endif
