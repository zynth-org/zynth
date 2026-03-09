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

set(ZYNTH_CORE_CPP_DIR_MONOREPO ${CMAKE_CURRENT_SOURCE_DIR}/../../../zynth-core/android/ZynthKit/src/main/cpp)
set(ZYNTH_CORE_CPP_DIR_PACKAGE ${CMAKE_CURRENT_SOURCE_DIR}/../../../core/android/ZynthKit/src/main/cpp)

if(EXISTS "${ZYNTH_CORE_CPP_DIR_MONOREPO}/ZynthJSIPluginRegistry.h")
  set(ZYNTH_CORE_CPP_DIR ${ZYNTH_CORE_CPP_DIR_MONOREPO})
elseif(EXISTS "${ZYNTH_CORE_CPP_DIR_PACKAGE}/ZynthJSIPluginRegistry.h")
  set(ZYNTH_CORE_CPP_DIR ${ZYNTH_CORE_CPP_DIR_PACKAGE})
else()
  message(FATAL_ERROR "Unable to locate @zynth/core Android headers. Checked ${ZYNTH_CORE_CPP_DIR_MONOREPO} and ${ZYNTH_CORE_CPP_DIR_PACKAGE}")
endif()

target_include_directories(zynthanimate
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    ${ZYNTH_CORE_CPP_DIR}
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
)

target_link_libraries(zynthanimate
  PRIVATE
    ReactAndroid::jsi
    log
    android
)

target_link_options(zynthanimate PRIVATE
  -Wl,-z,max-page-size=16384
  -Wl,-z,common-page-size=16384
)
