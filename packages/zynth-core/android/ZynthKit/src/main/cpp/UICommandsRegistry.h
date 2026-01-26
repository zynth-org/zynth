#pragma once

#include <jsi/jsi.h>
#include <memory>
#include <string>

namespace zynth::kit {

using UICommandsState = std::shared_ptr<void>;
using UICommandsInstaller = void (*)(const UICommandsState &, facebook::jsi::Runtime &);

void registerUICommandsInstaller(UICommandsInstaller installer);
void installUICommandsRegistry(const UICommandsState &state, facebook::jsi::Runtime &rt);

void uiCommandSetProp(
    const UICommandsState &state,
    int nodeId,
    const std::string &name,
    const std::string &value);

} // namespace zynth::kit
