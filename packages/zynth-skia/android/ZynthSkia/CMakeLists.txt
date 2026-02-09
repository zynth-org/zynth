cmake_minimum_required(VERSION 3.22.1)
project(zynthskia LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_library(zynthskia SHARED
  src/main/cpp/ZynthSkiaJSI.cpp
)

find_package(ReactAndroid REQUIRED CONFIG)

set(SKIA_VENDOR_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../native/vendor/android/${ANDROID_ABI}/gl-pdf")
set(SKIA_VENDOR_LIB "${SKIA_VENDOR_DIR}/libskia.a")
set(SKIA_BINDINGS_VENDOR_LIB "${SKIA_VENDOR_DIR}/libskia-bindings.a")

if(EXISTS "${SKIA_VENDOR_LIB}" AND EXISTS "${SKIA_BINDINGS_VENDOR_LIB}")
  add_library(zynth_skia_vendor STATIC IMPORTED)
  set_target_properties(zynth_skia_vendor PROPERTIES
    IMPORTED_LOCATION "${SKIA_VENDOR_LIB}"
  )

  add_library(zynth_skia_bindings_vendor STATIC IMPORTED)
  set_target_properties(zynth_skia_bindings_vendor PROPERTIES
    IMPORTED_LOCATION "${SKIA_BINDINGS_VENDOR_LIB}"
  )
  target_compile_definitions(zynthskia PRIVATE ZYNTH_SKIA_VENDOR_AVAILABLE=1)
else()
  message(WARNING "Skia vendor binaries missing for ABI ${ANDROID_ABI}. Falling back to platform canvas renderer.")
  target_compile_definitions(zynthskia PRIVATE ZYNTH_SKIA_VENDOR_AVAILABLE=0)
endif()

target_include_directories(zynthskia
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../zynth-core/android/ZynthKit/src/main/cpp
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
)

target_link_libraries(zynthskia
  PRIVATE
    ReactAndroid::jsi
    log
    android
    jnigraphics
    m
    z
)

if(TARGET zynth_skia_bindings_vendor AND TARGET zynth_skia_vendor)
  target_link_libraries(zynthskia
    PRIVATE
      zynth_skia_bindings_vendor
      zynth_skia_vendor
      EGL
      GLESv2
  )
endif()
