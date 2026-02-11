cmake_minimum_required(VERSION 3.22.1)
project(zynthskia LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(SKIA_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../native/vendor)
set(SKIA_HEADERS ${SKIA_ROOT}/headers/skia)
set(SKIA_ANDROID_LIB_DIR ${SKIA_ROOT}/android/${ANDROID_ABI}/gl-pdf)

add_library(zynthskia SHARED
  src/main/cpp/ZynthSkiaJSI.cpp
)

find_package(ReactAndroid REQUIRED CONFIG)

file(GLOB SKIA_STATIC_LIBS "${SKIA_ANDROID_LIB_DIR}/*.a")

if(NOT EXISTS "${SKIA_ANDROID_LIB_DIR}/libskia.a")
  message(FATAL_ERROR "Skia binaries not found for ABI ${ANDROID_ABI} at ${SKIA_ANDROID_LIB_DIR}")
endif()

target_include_directories(zynthskia
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../zynth-core/android/ZynthKit/src/main/cpp
    ${SKIA_HEADERS}
    ${SKIA_HEADERS}/include
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
)

target_link_libraries(zynthskia
  PRIVATE
    ReactAndroid::jsi
    jnigraphics
    log
    android
    ${SKIA_STATIC_LIBS}
)
