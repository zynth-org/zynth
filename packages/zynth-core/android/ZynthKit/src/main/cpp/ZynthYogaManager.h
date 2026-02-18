#pragma once

#include <yoga/Yoga.h>
#include <unordered_map>
#include <mutex>
#include <vector>
#include <memory>
#include <fbjni/fbjni.h>

namespace zynth {
namespace kit {

class ZynthYogaManager {
public:
  ZynthYogaManager();
  ~ZynthYogaManager();

  void setUIManager(facebook::jni::alias_ref<facebook::jni::JObject> uiManager);
  void createNode(int nodeId, facebook::jni::alias_ref<facebook::jni::JObject> view);
  void removeNode(int nodeId);
  void insertChild(int parentId, int childId, int index);
  void removeChild(int parentId, int childId);
  
  YGNodeRef getNode(int nodeId);
  
  void calculateLayout(int rootWidth, int rootHeight);
  
  // Get a buffer of frames: [nodeId, left, top, width, height, ...]
  std::vector<float> getLayoutResults();

private:
  struct MeasureContext {
    ZynthYogaManager* manager;
    int nodeId;
  };

  static YGSize measureTextNode(
      YGNodeConstRef node,
      float width,
      YGMeasureMode widthMode,
      float height,
      YGMeasureMode heightMode);
  YGSize measureTextNodeImpl(
      int nodeId,
      float width,
      YGMeasureMode widthMode,
      float height,
      YGMeasureMode heightMode);

  YGConfigRef config_;
  YGNodeRef rootNode_;
  std::unordered_map<int, YGNodeRef> nodes_;
  std::unordered_map<int, facebook::jni::global_ref<facebook::jni::JObject>> viewRefs_;
  std::unordered_map<int, bool> isTextNode_;
  std::unordered_map<int, std::unique_ptr<MeasureContext>> measureContexts_;
  facebook::jni::global_ref<facebook::jni::JObject> uiManagerRef_;
  jmethodID measureNodeMethod_ = nullptr;
  std::mutex mutex_;
};

} // namespace kit
} // namespace zynth
