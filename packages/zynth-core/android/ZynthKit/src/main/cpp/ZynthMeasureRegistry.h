#pragma once

#include <yoga/Yoga.h>
#include <cstdint>
#include <unordered_map>
#include <functional>

namespace zynth {

struct MeasureCacheKey {
  int32_t nodeId;
  uint32_t revision;
  float width;
  YGMeasureMode widthMode;
  float height;
  YGMeasureMode heightMode;

  bool operator==(const MeasureCacheKey& o) const {
    return nodeId == o.nodeId && revision == o.revision &&
           width == o.width && widthMode == o.widthMode &&
           height == o.height && heightMode == o.heightMode;
  }
};

struct MeasureCacheKeyHash {
  size_t operator()(const MeasureCacheKey& k) const {
    size_t h1 = std::hash<int32_t>()(k.nodeId);
    size_t h2 = std::hash<uint32_t>()(k.revision);
    size_t h3 = std::hash<float>()(k.width);
    size_t h4 = std::hash<int>()(static_cast<int>(k.widthMode));
    size_t h5 = std::hash<float>()(k.height);
    size_t h6 = std::hash<int>()(static_cast<int>(k.heightMode));
    return h1 ^ (h2 << 1) ^ (h3 << 2) ^ (h4 << 3) ^ (h5 << 4) ^ (h6 << 5);
  }
};

class ZynthMeasureRegistry {
public:
  using MeasureCallback = std::function<YGSize(int32_t nodeId, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode)>;

  void setCallback(MeasureCallback cb) {
    callback_ = std::move(cb);
  }

  YGSize measure(int32_t nodeId, uint32_t revision, float width, YGMeasureMode widthMode, float height, YGMeasureMode heightMode, uint32_t& cacheHits, uint32_t& cacheMisses) {
    MeasureCacheKey key{nodeId, revision, width, widthMode, height, heightMode};
    auto it = cache_.find(key);
    if (it != cache_.end()) {
      cacheHits++;
      return it->second;
    }
    cacheMisses++;
    if (callback_) {
      YGSize result = callback_(nodeId, width, widthMode, height, heightMode);
      cache_[key] = result;
      return result;
    }
    return {0, 0};
  }

  void clear() {
    cache_.clear();
  }

private:
  MeasureCallback callback_;
  std::unordered_map<MeasureCacheKey, YGSize, MeasureCacheKeyHash> cache_;
};

} // namespace zynth
