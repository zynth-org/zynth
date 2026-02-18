#include "ZynthYogaManager.h"
#include <android/log.h>
#include <yoga/Yoga.h>
#include <cmath>
#include <cstdint>
#include <algorithm>

#ifndef ZYNTH_ENABLE_YOGA_DEBUG_LOGS
#define ZYNTH_ENABLE_YOGA_DEBUG_LOGS 0
#endif

#if ZYNTH_ENABLE_YOGA_DEBUG_LOGS
#define ZYNTH_YOGA_LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, "ZynthYoga", __VA_ARGS__)
#else
#define ZYNTH_YOGA_LOGD(...) ((void)0)
#endif

namespace zynth {
namespace kit {

ZynthYogaManager::ZynthYogaManager() {
  config_ = YGConfigNew();
  YGConfigSetUseWebDefaults(config_, false);
  rootNode_ = YGNodeNewWithConfig(config_);
  YGNodeStyleSetFlexDirection(rootNode_, YGFlexDirectionColumn);
  YGNodeStyleSetAlignItems(rootNode_, YGAlignStretch);
  ZYNTH_YOGA_LOGD("ZynthYogaManager initialized, rootNode=%p", rootNode_);
}

ZynthYogaManager::~ZynthYogaManager() {
  uiManagerRef_.reset();
  for (auto& pair : viewRefs_) {
    pair.second.reset();
  }
  for (auto& pair : nodes_) {
    YGNodeFree(pair.second);
  }
  YGNodeFree(rootNode_);
  YGConfigFree(config_);
}

void ZynthYogaManager::setUIManager(facebook::jni::alias_ref<facebook::jni::JObject> uiManager) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (uiManager == nullptr) return;
  uiManagerRef_ = facebook::jni::make_global(uiManager);
  JNIEnv* env = facebook::jni::Environment::current();
  jclass uiClass = env->GetObjectClass(uiManager.get());
  measureNodeMethod_ = env->GetMethodID(uiClass, "measureNodeForYoga", "(IFIFI)J");
  env->DeleteLocalRef(uiClass);
}

void ZynthYogaManager::createNode(int nodeId, facebook::jni::alias_ref<facebook::jni::JObject> view) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (nodes_.count(nodeId)) return;

  YGNodeRef node = YGNodeNewWithConfig(config_);
  nodes_[nodeId] = node;
  isTextNode_[nodeId] = false;
  if (view != nullptr) {
    viewRefs_.insert({nodeId, facebook::jni::make_global(view)});
    JNIEnv* env = facebook::jni::Environment::current();
    jclass textViewClass = env->FindClass("android/widget/TextView");
    if (textViewClass != nullptr && env->IsInstanceOf(view.get(), textViewClass)) {
      isTextNode_[nodeId] = true;
      auto ctx = std::make_unique<MeasureContext>();
      ctx->manager = this;
      ctx->nodeId = nodeId;
      YGNodeSetContext(node, ctx.get());
      YGNodeSetMeasureFunc(node, &ZynthYogaManager::measureTextNode);
      measureContexts_[nodeId] = std::move(ctx);
      ZYNTH_YOGA_LOGD("Attached text measure function to node %d", nodeId);
    }
    if (textViewClass != nullptr) {
      env->DeleteLocalRef(textViewClass);
    }
  }
  ZYNTH_YOGA_LOGD("Created node %d (%p)", nodeId, node);
}

void ZynthYogaManager::removeNode(int nodeId) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = nodes_.find(nodeId);
  if (it == nodes_.end()) return;

  YGNodeRef node = it->second;
  YGNodeSetMeasureFunc(node, nullptr);
  YGNodeSetContext(node, nullptr);
  YGNodeFree(node);
  nodes_.erase(it);
  viewRefs_.erase(nodeId);
  isTextNode_.erase(nodeId);
  measureContexts_.erase(nodeId);
  lastLayoutFrames_.erase(nodeId);
  ZYNTH_YOGA_LOGD("Removed node %d", nodeId);
}

void ZynthYogaManager::insertChild(int parentId, int childId, int index) {
  std::lock_guard<std::mutex> lock(mutex_);
  YGNodeRef parent = rootNode_;
  if (parentId != 0) {
    auto pit = nodes_.find(parentId);
    parent = pit != nodes_.end() ? pit->second : nullptr;
  }
  auto cit = nodes_.find(childId);
  YGNodeRef child = cit != nodes_.end() ? cit->second : nullptr;
  if (!parent || !child) {
    __android_log_print(ANDROID_LOG_ERROR, "ZynthYoga", "insertChild failed: parent=%p, child=%p (ids %d, %d)", parent, child, parentId, childId);
    return;
  }

  // Keep text composition semantics aligned with Kotlin path:
  // text -> text should not build a Yoga subtree.
  if (parentId != 0 && isTextNode_[parentId] && isTextNode_[childId]) {
    ZYNTH_YOGA_LOGD("Skipped text->text insert %d -> %d", parentId, childId);
    return;
  }

  // Yoga leaf nodes with measure functions cannot have children.
  // If this node is about to become a parent, disable its measure function.
  if (parentId != 0 && YGNodeHasMeasureFunc(parent)) {
    YGNodeSetMeasureFunc(parent, nullptr);
    ZYNTH_YOGA_LOGD("Disabled measure function for parent %d before insert", parentId);
  }

  if (YGNodeGetOwner(child)) {
    YGNodeRemoveChild(YGNodeGetOwner(child), child);
  }
  
  uint32_t targetIndex = static_cast<uint32_t>(index);
  if (targetIndex > YGNodeGetChildCount(parent)) {
    targetIndex = YGNodeGetChildCount(parent);
  }
  YGNodeInsertChild(parent, child, targetIndex);
  ZYNTH_YOGA_LOGD("Inserted child %d into parent %d at index %d", childId, parentId, targetIndex);
}

void ZynthYogaManager::removeChild(int parentId, int childId) {
  std::lock_guard<std::mutex> lock(mutex_);
  YGNodeRef parent = rootNode_;
  if (parentId != 0) {
    auto pit = nodes_.find(parentId);
    parent = pit != nodes_.end() ? pit->second : nullptr;
  }
  auto cit = nodes_.find(childId);
  YGNodeRef child = cit != nodes_.end() ? cit->second : nullptr;
  if (!parent || !child) return;

  if (parentId != 0 && isTextNode_[parentId] && isTextNode_[childId]) {
    ZYNTH_YOGA_LOGD("Skipped text->text remove %d -> %d", parentId, childId);
    return;
  }

  YGNodeRemoveChild(parent, child);
  ZYNTH_YOGA_LOGD("Removed child %d from parent %d", childId, parentId);

  // If a text node becomes a leaf again, restore its measure function.
  if (parentId != 0 && YGNodeGetChildCount(parent) == 0) {
    auto ctxIt = measureContexts_.find(parentId);
    if (ctxIt != measureContexts_.end() && !YGNodeHasMeasureFunc(parent)) {
      YGNodeSetContext(parent, ctxIt->second.get());
      YGNodeSetMeasureFunc(parent, &ZynthYogaManager::measureTextNode);
      ZYNTH_YOGA_LOGD("Restored measure function for leaf parent %d", parentId);
    }
  }
}

YGNodeRef ZynthYogaManager::getNode(int nodeId) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = nodes_.find(nodeId);
  if (it != nodes_.end()) {
    return it->second;
  }
  return nullptr;
}

void ZynthYogaManager::calculateLayout(int rootWidth, int rootHeight) {
  std::lock_guard<std::mutex> lock(mutex_);
  YGNodeStyleSetWidth(rootNode_, static_cast<float>(rootWidth));
  YGNodeStyleSetHeight(rootNode_, static_cast<float>(rootHeight));
  YGNodeCalculateLayout(rootNode_, static_cast<float>(rootWidth), static_cast<float>(rootHeight), YGDirectionLTR);
  ZYNTH_YOGA_LOGD("Layout calculated for root %dx%d", rootWidth, rootHeight);
}

void ZynthYogaManager::getLayoutResults(
    std::vector<float>& outResults,
    bool deltaOnly,
    bool* didFullSync,
    size_t* totalNodeCount) {
  std::lock_guard<std::mutex> lock(mutex_);
  const bool fullSync = !deltaOnly || lastLayoutFrames_.empty();
  if (didFullSync != nullptr) {
    *didFullSync = fullSync;
  }
  if (totalNodeCount != nullptr) {
    *totalNodeCount = nodes_.size();
  }

  outResults.clear();
  outResults.reserve(nodes_.size() * 5);
  int zeroAreaCount = 0;
  int invalidCount = 0;
  int sampleCount = 0;
  char sample[384];
  sample[0] = '\0';
  size_t sampleLen = 0;

  for (auto const& [nodeId, node] : nodes_) {
    float left = YGNodeLayoutGetLeft(node);
    float top = YGNodeLayoutGetTop(node);
    float width = YGNodeLayoutGetWidth(node);
    float height = YGNodeLayoutGetHeight(node);
    if (!std::isfinite(left) || !std::isfinite(top) || !std::isfinite(width) || !std::isfinite(height)) {
      invalidCount += 1;
    }
    if (width <= 0.0f || height <= 0.0f) {
      zeroAreaCount += 1;
    }
    if (sampleCount < 4) {
      int written = snprintf(
          sample + sampleLen,
          sizeof(sample) - sampleLen,
          "%s{id=%d l=%.1f t=%.1f w=%.1f h=%.1f}",
          sampleCount == 0 ? "" : " ",
          nodeId,
          left,
          top,
          width,
          height);
      if (written > 0) {
        sampleLen += static_cast<size_t>(written);
        sampleCount += 1;
      }
    }
    
    const LayoutFrame current{left, top, width, height};
    bool changed = fullSync;
    if (!changed) {
      auto it = lastLayoutFrames_.find(nodeId);
      if (it == lastLayoutFrames_.end()) {
        changed = true;
      } else {
        const LayoutFrame& prev = it->second;
        changed =
            std::fabs(prev.left - current.left) > 0.01f ||
            std::fabs(prev.top - current.top) > 0.01f ||
            std::fabs(prev.width - current.width) > 0.01f ||
            std::fabs(prev.height - current.height) > 0.01f;
      }
    }
    lastLayoutFrames_[nodeId] = current;
    if (changed) {
      outResults.push_back(static_cast<float>(nodeId));
      outResults.push_back(left);
      outResults.push_back(top);
      outResults.push_back(width);
      outResults.push_back(height);
    }
  }
  ZYNTH_YOGA_LOGD(
      "getLayoutResults: nodes=%zu zeroArea=%d invalid=%d sample=%s",
      nodes_.size(),
      zeroAreaCount,
      invalidCount,
      sample);
}

size_t ZynthYogaManager::getNodeCount() {
  std::lock_guard<std::mutex> lock(mutex_);
  return nodes_.size();
}

YGSize ZynthYogaManager::measureTextNode(
    YGNodeConstRef node,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode) {
  auto* ctx = static_cast<MeasureContext*>(YGNodeGetContext(const_cast<YGNodeRef>(node)));
  if (ctx == nullptr || ctx->manager == nullptr) {
    return YGSize{0.0f, 0.0f};
  }
  return ctx->manager->measureTextNodeImpl(ctx->nodeId, width, widthMode, height, heightMode);
}

YGSize ZynthYogaManager::measureTextNodeImpl(
    int nodeId,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode) {
  if (!uiManagerRef_ || !measureNodeMethod_) {
    return YGSize{0.0f, 0.0f};
  }
  JNIEnv* env = facebook::jni::Environment::current();
  jlong packed = env->CallLongMethod(
      uiManagerRef_.get(),
      measureNodeMethod_,
      static_cast<jint>(nodeId),
      static_cast<jfloat>(width),
      static_cast<jint>(widthMode),
      static_cast<jfloat>(height),
      static_cast<jint>(heightMode));
  if (env->ExceptionCheck()) {
    env->ExceptionClear();
    return YGSize{0.0f, 0.0f};
  }
  int measuredWidth = static_cast<int>(static_cast<uint64_t>(packed) >> 32);
  int measuredHeight = static_cast<int>(static_cast<uint64_t>(packed) & 0xffffffffULL);
  return YGSize{static_cast<float>(measuredWidth), static_cast<float>(measuredHeight)};
}

} // namespace kit
} // namespace zynth
