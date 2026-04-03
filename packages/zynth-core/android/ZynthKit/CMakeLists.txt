cmake_minimum_required(VERSION 3.22.1)
project(zynthkit LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

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

if(AXON_ROOT AND EXISTS "${AXON_LIB_PATH}")
  add_library(axon_engine STATIC IMPORTED)
  set_target_properties(axon_engine PROPERTIES IMPORTED_LOCATION "${AXON_LIB_PATH}")
  set(ZYNTH_AXON_LINKED 1)
else()
  message(WARNING "Axon Android static library not found. Checked root='${AXON_ROOT}' lib='${AXON_LIB_PATH}'. Build it from /Users/ignaciozsabo/code/zynth/axon/lib for the target ABI before Android linking.")
  set(ZYNTH_AXON_LINKED 0)
endif()

add_library(zynthkit SHARED
  src/main/cpp/zynthkit.cpp
  src/main/cpp/UICommandsRegistry.cpp
  src/main/cpp/ScrollViewUICommands.cpp
)

find_package(hermes-engine REQUIRED CONFIG)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

target_include_directories(zynthkit
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
    $<TARGET_PROPERTY:ReactAndroid::jsi,INTERFACE_INCLUDE_DIRECTORIES>
)

target_compile_definitions(zynthkit PRIVATE ZYNTH_AXON_LINKED=${ZYNTH_AXON_LINKED})

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
    $<$<TARGET_EXISTS:axon_engine>:axon_engine>
    log
)

target_link_options(zynthkit PRIVATE
  -Wl,-z,max-page-size=16384
  -Wl,-z,common-page-size=16384
)
