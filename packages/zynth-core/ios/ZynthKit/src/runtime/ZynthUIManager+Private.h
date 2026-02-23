#import "ZynthUIManager.h"
#import "ZynthYogaLayout.h"
#import "ZynthNode.h"
#import "ZynthComponentRegistry.h"
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthViewStyleState;
@class ZynthTextStyleState;

@interface ZynthUIManager () {
  __weak UIView *_rootView;
  NSMutableDictionary<NSNumber *, UIView *> *_nodes;
  NSMutableDictionary<NSNumber *, ZynthNode *> *_nodeStates;
  NSMutableDictionary<NSString *, NSDictionary *> *_eventPayloads;
  NSMutableDictionary<NSNumber *, NSNumber *> *_parents;
  NSMutableDictionary<NSNumber *, NSNumber *> *_nodeSurfaces;
  NSMutableDictionary<NSNumber *, UIView *> *_surfaceRoots;
  NSMutableDictionary<NSNumber *, ZynthYogaLayout *> *_surfaceYoga;
  NSMutableSet<NSNumber *> *_dirtySurfaces;
  NSMutableDictionary<NSNumber *, NSValue *> *_surfaceSizes;
  NSMutableDictionary<NSNumber *, NSMutableArray<dispatch_block_t> *> *_surfaceFirstFrameListeners;
  NSMutableSet<NSNumber *> *_surfaceFirstFrameDispatched;
  NSMutableSet<NSNumber *> *_ownedSurfaces;
  NSHashTable<UIView *> *_surfaceObserved;
  int _surfaceIdSeed;
  int _activeSurfaceId;
  NSMutableDictionary<NSNumber *, NSString *> *_pointerEvents;
  NSMutableSet<NSNumber *> *_pressNodes;
  NSMutableSet<NSNumber *> *_longPressNodes;
  NSMutableSet<NSNumber *> *_doublePressNodes;
  NSMutableSet<NSNumber *> *_activePressNodes;
  NSMutableSet<NSNumber *> *_longPressFired;
  NSMutableDictionary<NSNumber *, NSNumber *> *_longPressDurations;
  NSMutableDictionary<NSNumber *, NSNumber *> *_doublePressWindows;
  NSMutableDictionary<NSNumber *, NSNumber *> *_lastPressTimestamps;
  NSMutableDictionary<NSNumber *, NSValue *> *_pressLocalPoints;
  NSMutableDictionary<NSNumber *, NSValue *> *_pressScreenPoints;
  NSMutableDictionary<NSNumber *, dispatch_source_t> *_longPressTimers;
  NSMutableSet<NSNumber *> *_layoutNodes;
  NSMutableSet<NSNumber *> *_layoutPending;
  NSMutableDictionary<NSNumber *, NSValue *> *_layoutFrames;
  NSMutableDictionary<NSNumber *, ZynthViewStyleState *> *_styleStates;
  NSMutableSet<NSNumber *> *_styleDirtyNodes;
  NSMutableDictionary<NSNumber *, NSValue *> *_styleLayoutFrames;
  NSMutableSet<NSNumber *> *_styleLayoutDirtyNodes;
  NSMutableDictionary<NSNumber *, ZynthTextStyleState *> *_textStyleStates;
  NSMutableDictionary<NSNumber *, NSMutableDictionary<NSString *, id> *> *_yogaStyleCache;
  int _nextId;
  CADisplayLink *_displayLink;
  BOOL _needsLayout;
  BOOL _frameInProgress;
  BOOL _didWarmup;
  NSUInteger _budgetOverruns;
  NSTimeInterval _lastLayoutMs;
  NSTimeInterval _lastFrameMs;
  BOOL _didDispatchFirstMountCommit;
  dispatch_block_t _Nullable _firstMountCommitListener;
  void (^_frameProfiler)(NSTimeInterval frameMs,
                         NSTimeInterval layoutMs,
                         BOOL overBudget,
                         NSUInteger nodeCount);
}

- (UIView *_Nullable)viewForNodeId:(NSNumber *)nodeId;

@end

NS_ASSUME_NONNULL_END
