cmake_minimum_required(VERSION 3.22.1)
project(zynthkit LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT DEFINED ZYNTH_LAYOUT_ENGINE)
  set(ZYNTH_LAYOUT_ENGINE "YOGA")
endif()
string(TOUPPER "${ZYNTH_LAYOUT_ENGINE}" ZYNTH_LAYOUT_ENGINE)

if(NOT DEFINED ZYNTH_AXON_ENABLED)
  if(ZYNTH_LAYOUT_ENGINE STREQUAL "AXON")
    set(ZYNTH_AXON_ENABLED ON)
  else()
    set(ZYNTH_AXON_ENABLED OFF)
  endif()
endif()

set(AXON_ROOT_CANDIDATES
  "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../axon/lib"
  "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../axon/lib"
)
set(AXON_ROOT "")
foreach(candidate IN LISTS AXON_ROOT_CANDIDATES)
  if(EXISTS "${candidate}/Cargo.toml")
    set(AXON_ROOT "${candidate}")
    break()
  endif()
endforeach()
set(AXON_ANDROID_ABI_DIR "${AXON_ROOT}/target/android/${ANDROID_ABI}")
set(AXON_LIB_PATH "${AXON_ANDROID_ABI_DIR}/libaxon_engine.a")

if(ZYNTH_AXON_ENABLED AND AXON_ROOT AND EXISTS "${AXON_LIB_PATH}")
  add_library(axon_engine STATIC IMPORTED)
  set_target_properties(axon_engine PROPERTIES IMPORTED_LOCATION "${AXON_LIB_PATH}")
  set(ZYNTH_AXON_LINKED 1)
elseif(ZYNTH_AXON_ENABLED)
  message(FATAL_ERROR "Axon Android static library not found. Checked root='${AXON_ROOT}' lib='${AXON_LIB_PATH}'. Build it before Android linking.")
else()
  set(ZYNTH_AXON_LINKED 0)
endif()

set(ZYNTH_YOGA_LIB_PATH
  "${CMAKE_CURRENT_SOURCE_DIR}/build/yoga-extracted/jni/${ANDROID_ABI}/libyoga.so"
)
if(ZYNTH_LAYOUT_ENGINE STREQUAL "YOGA")
  if(EXISTS "${ZYNTH_YOGA_LIB_PATH}")
    add_library(zynth_yoga SHARED IMPORTED)
    set_target_properties(zynth_yoga PROPERTIES IMPORTED_LOCATION "${ZYNTH_YOGA_LIB_PATH}")
  else()
    message(FATAL_ERROR "Yoga Android shared library not found at ${ZYNTH_YOGA_LIB_PATH}. Run Gradle dependency resolution for com.facebook.yoga:yoga first.")
  endif()
endif()

set(ZYNTHKIT_SOURCES
  src/main/cpp/zynthkit.cpp
  src/main/cpp/UICommandsRegistry.cpp
  src/main/cpp/ScrollViewUICommands.cpp
)

if(ZYNTH_LAYOUT_ENGINE STREQUAL "YOGA")
  list(APPEND ZYNTHKIT_SOURCES src/main/cpp/ZynthYogaLayoutRuntime.cpp)
endif()

add_library(zynthkit SHARED ${ZYNTHKIT_SOURCES})

find_package(hermes-engine REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

target_include_directories(zynthkit
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
    $<TARGET_PROPERTY:ReactAndroid::reactnative,INTERFACE_INCLUDE_DIRECTORIES>
)

target_compile_definitions(zynthkit PRIVATE
  ZYNTH_AXON_LINKED=${ZYNTH_AXON_LINKED}
  $<$<STREQUAL:${ZYNTH_LAYOUT_ENGINE},AXON>:ZYNTH_LAYOUT_ENGINE_AXON=1>
  $<$<STREQUAL:${ZYNTH_LAYOUT_ENGINE},YOGA>:ZYNTH_LAYOUT_ENGINE_YOGA=1>
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
    $<$<STREQUAL:${ZYNTH_LAYOUT_ENGINE},YOGA>:ReactAndroid::reactnative>
    fbjni::fbjni
    $<$<TARGET_EXISTS:axon_engine>:axon_engine>
    $<$<TARGET_EXISTS:zynth_yoga>:zynth_yoga>
    log
)

target_link_options(zynthkit PRIVATE
  -Wl,-z,max-page-size=16384
  -Wl,-z,common-page-size=16384
)
