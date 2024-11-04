cmake_minimum_required(VERSION 3.22.1)
project(rune_kit)

add_library(rune_kit SHARED
    src/main/cpp/rune_kit.cpp
    src/main/cpp/Bridge.cpp)

target_link_libraries(rune_kit
    android
    log)
