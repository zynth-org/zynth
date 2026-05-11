#pragma once

#include <cstdint>
#include <chrono>
#include <string>
#include <android/log.h>

namespace zynth {

/**
 * @brief Phase-level timing for a single renderer commit.
 *
 * Tracks microsecond-resolution durations across every stage of the
 * commit pipeline so that regressions can be attributed to a specific phase.
 */
struct ZynthCommitTelemetry {
  uint64_t commitId = 0;

  // Phase timers (microseconds)
  int64_t jsiEntryUs       = 0; ///< Time from JSI host function entry to payload extraction
  int64_t nativeDecodeUs   = 0; ///< Time to decode ops into native ZynthCommit
  int64_t kotlinDecodeUs   = 0; ///< Legacy: time Kotlin spends decoding ops (if applicable)
  int64_t commitApplyUs    = 0; ///< Time to apply commit to native state
  int64_t yogaMutateUs     = 0; ///< Time to mutate Yoga nodes
  int64_t yogaCalculateUs  = 0; ///< Time spent inside YGNodeCalculateLayout
  int64_t frameExtractUs   = 0; ///< Time to diff/extract layout frames after Yoga
  int64_t measureCallbackUs = 0; ///< Accumulated text/intrinsic measurement time
  int64_t jniBuildUs       = 0; ///< Time to build JNI transaction
  int64_t mainApplyUs      = 0; ///< Time for main-thread transaction apply
  int64_t layoutEventUs    = 0; ///< Time to dispatch layout events

  // Counters
  uint32_t opCount         = 0; ///< Total decoded ops
  uint32_t setPropCount    = 0; ///< Number of setProp ops
  uint32_t setTextCount    = 0; ///< Number of setText ops
  uint32_t insertCount     = 0; ///< Number of insertChild ops
  uint32_t removeCount     = 0; ///< Number of removeChild ops
  uint32_t dropCount       = 0; ///< Number of dropNode ops
  uint32_t createCount     = 0; ///< Number of createNode ops
  uint32_t surfaceCount    = 0; ///< Number of setSurface ops

  uint32_t layoutPropCount = 0; ///< Props classified as layout
  uint32_t viewPropCount   = 0; ///< Props classified as view
  uint32_t textPropCount   = 0; ///< Props classified as text/intrinsic
  uint32_t descriptorPropCount = 0; ///< Props classified as component-specific

  uint32_t measureCacheHits   = 0;
  uint32_t measureCacheMisses = 0;
  uint32_t measureCacheBypasses = 0;
  uint32_t mutatedNodeCount   = 0;
  uint32_t layoutNodeCount    = 0;
  uint32_t changedFrameCount  = 0;
  uint32_t dirtySurfaceCount  = 0;
  uint32_t applyPassCount     = 0;

  /**
   * @brief Emit one-line summary via __android_log_print (debug builds only).
   */
  void logSummary() const {
#ifndef NDEBUG
    const double totalMs =
        (jsiEntryUs + nativeDecodeUs + kotlinDecodeUs + commitApplyUs +
         yogaMutateUs + yogaCalculateUs + measureCallbackUs + jniBuildUs +
         mainApplyUs + layoutEventUs) / 1000.0;
    __android_log_print(
        ANDROID_LOG_DEBUG, "ZynthCommit",
        "commit=%llu total=%.2fms jsi=%.2f decode=%.2f ktDecode=%.2f "
        "apply=%.2f yogaMut=%.2f yogaCalc=%.2f frameExtract=%.2f measure=%.2f "
        "jniBuild=%.2f mainApply=%.2f events=%.2f "
        "ops=%u props(L/V/T/D)=%u/%u/%u/%u measureCache(H/M/B)=%u/%u/%u changedFrames=%u dirtySurfaces=%u",
        static_cast<unsigned long long>(commitId),
        totalMs,
        jsiEntryUs / 1000.0,
        nativeDecodeUs / 1000.0,
        kotlinDecodeUs / 1000.0,
        commitApplyUs / 1000.0,
        yogaMutateUs / 1000.0,
        yogaCalculateUs / 1000.0,
        frameExtractUs / 1000.0,
        measureCallbackUs / 1000.0,
        jniBuildUs / 1000.0,
        mainApplyUs / 1000.0,
        layoutEventUs / 1000.0,
        opCount,
        layoutPropCount,
        viewPropCount,
        textPropCount,
        descriptorPropCount,
        measureCacheHits,
        measureCacheMisses,
        measureCacheBypasses,
        changedFrameCount,
        dirtySurfaceCount);
#endif
  }
};

/**
 * @brief RAII microsecond timer that writes elapsed time to a target variable.
 */
class ZynthPhaseTimer {
public:
  explicit ZynthPhaseTimer(int64_t &target)
      : target_(target),
        start_(std::chrono::steady_clock::now()) {}

  ~ZynthPhaseTimer() {
    auto end = std::chrono::steady_clock::now();
    target_ = std::chrono::duration_cast<std::chrono::microseconds>(end - start_).count();
  }

  // Non-copyable
  ZynthPhaseTimer(const ZynthPhaseTimer &) = delete;
  ZynthPhaseTimer &operator=(const ZynthPhaseTimer &) = delete;

private:
  int64_t &target_;
  std::chrono::steady_clock::time_point start_;
};

/**
 * @brief Global monotonic commit ID generator.
 */
inline uint64_t nextCommitId() {
  static std::atomic<uint64_t> sCounter{1};
  return sCounter.fetch_add(1, std::memory_order_relaxed);
}

} // namespace zynth
