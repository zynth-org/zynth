cmake_minimum_required(VERSION 3.22.1)
project(zynthanimate LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_library(zynthanimate SHARED
  src/main/cpp/ZynthAnimateJSI.cpp
)

find_package(ReactAndroid REQUIRED CONFIG)

target_include_directories(zynthanimate
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../../../zynth-core/android/ZynthKit/src/main/cpp
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
)

target_link_libraries(zynthanimate
  PRIVATE
    ReactAndroid::jsi
    log
    android
)
