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
find_package(hermes-engine REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

target_include_directories(zynthkit
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
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
    fbjni::fbjni
    log
)

target_link_options(zynthkit PRIVATE
  -Wl,-z,max-page-size=16384
  -Wl,-z,common-page-size=16384
)
