# @queuert/helpers

Domain-free runtime and type helpers shared by the Queuert packages (timers, locks, shared listeners, number guards, error serialization, and similar). Private: each published package that imports it gets its own copy inlined by tsdown at build time, so nothing here may hold module-level state that needs a single identity across packages.
