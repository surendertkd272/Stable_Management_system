# CMakeLists.txt: CMake project for LinuxToolKitDemo; include source code and define
# project-specific logic here.
#
cmake_minimum_required (VERSION 3.8)

project ("LinuxToolKitDemo")

# This directive specifies the paths to the library files to be linked.
LINK_DIRECTORIES("/usr/lib" "/usr/local/lib")

INCLUDE_DIRECTORIES("./" "/usr/include" "/usr/local/include")

ADD_EXECUTABLE(LinuxToolKitDemo "DMSToolKit.h" "CSDKDemo.h" "CSDKDemo.cpp" "LinuxToolKitDemo.h" "LinuxToolKitDemo.cpp")

# This directive links the target executable with the specified libraries.
TARGET_LINK_LIBRARIES(LinuxToolKitDemo pthread)
TARGET_LINK_LIBRARIES(LinuxToolKitDemo VD641Module)

if (CMAKE_VERSION VERSION_GREATER 3.12)
  set_property(TARGET LinuxToolKitDemo PROPERTY CXX_STANDARD 11)
endif()
# TODO: Add tests and install targets if necessary.