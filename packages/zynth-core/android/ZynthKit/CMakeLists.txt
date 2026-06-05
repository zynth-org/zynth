cmake_minimum_required(VERSION 3.22.1)
project(zynthkit LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_library(zynthkit SHARED
  src/main/cpp/zynthkit.cpp
  src/main/cpp/UICommandsRegistry.cpp
  src/main/cpp/ScrollViewUICommands.cpp
  src/main/cpp/ZynthAnimateJSI.cpp
)

# Native renderer headers (Phase 0-2: telemetry, prop model, commit decoder, state)
target_sources(zynthkit PRIVATE
  src/main/cpp/ZynthRendererTelemetry.h
  src/main/cpp/ZynthProp.h
  src/main/cpp/ZynthCommit.h
  src/main/cpp/ZynthCommitDecoder.h
  src/main/cpp/ZynthRendererHost.h
)
find_package(hermes-engine REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

# Add Yoga prebuilt from vendor (updated with correct C symbols)
add_library(zynth_yoga SHARED IMPORTED)
set_target_properties(zynth_yoga PROPERTIES
  IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/../../native/vendor/android/${ANDROID_ABI}/libyoga.so
)

target_include_directories(zynthkit
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../native/vendor/headers
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
)

if(TARGET hermes-engine::hermesvm)
  set(ZYNTH_HERMES_TARGET hermes-engine::hermesvm)
elseif(TARGET hermes-engine::libhermes)
  set(ZYNTH_HERMES_TARGET hermes-engine::libhermes)
else()
  message(FATAL_ERROR "No Hermes prefab target found (expected hermes-engine::hermesvm or hermes-engine::libhermes)")
endif()

target_link_libraries(zynthkit
  PRIVATE
    ${ZYNTH_HERMES_TARGET}
    ReactAndroid::jsi
    zynth_yoga
    fbjni::fbjni
    log
)

target_link_options(zynthkit PRIVATE
  -Wl,-z,max-page-size=16384
  -Wl,-z,common-page-size=16384
)
