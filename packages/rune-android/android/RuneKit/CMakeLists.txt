cmake_minimum_required(VERSION 3.22.1)
project(rune_kit LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

add_library(rune_kit SHARED
    src/main/cpp/jni-entry.cpp
    src/main/cpp/Bridge.cpp
)

find_package(hermes-engine REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)

target_include_directories(rune_kit
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
)

target_compile_options(rune_kit
    PRIVATE
        -Wall
        -Wextra
        -fexceptions
        -frtti
)

set_target_properties(rune_kit PROPERTIES
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
)

target_link_libraries(rune_kit
    PRIVATE
        hermes-engine::libhermes
        ReactAndroid::jsi
        log
)
