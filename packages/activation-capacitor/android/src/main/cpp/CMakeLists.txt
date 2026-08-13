cmake_minimum_required(VERSION 3.22.1)
project("machineactivation")

# ---------------------------------------------------------------------------
# llama.cpp source location
#
# The SDK vendors llama.cpp source (not the prebuilt win-x64 binaries under
# vendor/llama-cpp, which are for the Electron template's llama-server).
#
# LLAMA_CPP_DIR can be overridden from Gradle so a consuming app can point at
# its own checkout. The default walks out of the npm package to the SDK's
# vendor directory, which works for `file:` installs because npm symlinks them.
# ---------------------------------------------------------------------------
if(NOT DEFINED LLAMA_CPP_DIR)
    # REALPATH is load-bearing. npm installs `file:` dependencies as symlinks,
    # so CMAKE_CURRENT_SOURCE_DIR is the app's node_modules path and a relative
    # walk from it lands in the APP's tree, not the SDK's. Resolving the link
    # first puts us back in the real package before walking out to vendor/.
    get_filename_component(_ma_cpp_real "${CMAKE_CURRENT_SOURCE_DIR}" REALPATH)

    set(_ma_candidates
        "${_ma_cpp_real}/../../../../../../vendor/llama-cpp-src"          # real package -> SDK root
        "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../vendor/llama-cpp-src"  # copied (non-symlink) install
        "${_ma_cpp_real}/../../../llama.cpp"                              # vendored inside the package
    )

    foreach(_candidate IN LISTS _ma_candidates)
        get_filename_component(_resolved "${_candidate}" ABSOLUTE)
        if(EXISTS "${_resolved}/include/llama.h")
            set(LLAMA_CPP_DIR "${_resolved}")
            break()
        endif()
    endforeach()

    if(NOT DEFINED LLAMA_CPP_DIR)
        set(LLAMA_CPP_DIR "${_ma_cpp_real}/../../../../../../vendor/llama-cpp-src")
    endif()
endif()

get_filename_component(LLAMA_CPP_DIR "${LLAMA_CPP_DIR}" ABSOLUTE)

if(NOT EXISTS "${LLAMA_CPP_DIR}/include/llama.h")
    message(FATAL_ERROR
        "llama.cpp source not found at ${LLAMA_CPP_DIR}.\n"
        "Clone it with:\n"
        "  git clone --depth 1 --branch b10182 https://github.com/ggml-org/llama.cpp <sdk>/vendor/llama-cpp-src\n"
        "or set -DLLAMA_CPP_DIR=<path> in the consuming app's gradle config.")
endif()

message(STATUS "machineactivation: using llama.cpp at ${LLAMA_CPP_DIR}")

# Build only what the bridge needs. Tools are ON because mtmd (multimodal —
# the mmproj / image-projector support this whole runtime exists for) lives
# under tools/mtmd.
set(BUILD_SHARED_LIBS      OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS      OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES   OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER     OFF CACHE BOOL "" FORCE)
# mtmd lives under tools/, so tools must be enabled. EXCLUDE_FROM_ALL below
# keeps the other tools configured-but-never-compiled: ninja only builds what
# `machineactivation` actually links. That matters on Windows, where the object
# paths for the deeper tools (cvector-generator and friends) come within ~20
# characters of the 250-char CMAKE_OBJECT_PATH_MAX limit.
set(LLAMA_BUILD_TOOLS      ON  CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON     ON  CACHE BOOL "" FORCE)
set(LLAMA_CURL             OFF CACHE BOOL "" FORCE)
# No OpenMP in the NDK sysroot; llamafile's sgemm has no aarch64-Android path.
set(GGML_OPENMP            OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE         OFF CACHE BOOL "" FORCE)

add_subdirectory("${LLAMA_CPP_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/llama.cpp" EXCLUDE_FROM_ALL)

add_library(machineactivation SHARED llama_jni.cpp)

target_include_directories(machineactivation PRIVATE
    "${LLAMA_CPP_DIR}/include"
    "${LLAMA_CPP_DIR}/ggml/include"
    "${LLAMA_CPP_DIR}/tools/mtmd"
)

find_library(log-lib log)

# mtmd pulls in llama and ggml transitively.
target_link_libraries(machineactivation
    mtmd
    llama
    ggml
    ${log-lib}
)

target_compile_options(machineactivation PRIVATE -O3 -fexceptions -frtti)
