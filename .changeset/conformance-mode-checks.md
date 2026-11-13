---
"queuert": minor
---

The state and notify adapter conformance cases check the adapter's mode on the adapter and client calls they make, not only inside transactions. Each case reads the mode from the adapter it creates: over a synchronous adapter (`sync: true`) it fails when a call returns a promise or rejects instead of throwing, and over an asynchronous one it fails when a call returns a plain value instead of a promise. A custom adapter that passed before can fail these cases now; return results directly from every method of a sync adapter, and promises from every method of an async one.
