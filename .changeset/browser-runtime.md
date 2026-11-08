---
"queuert": patch
---

`queuert` no longer depends on Node.js built-ins, so its client, worker runner and in-process adapters also run in browsers and service workers: the default job and worker ID generators use the Web Crypto `crypto.randomUUID()`, and page cursors are encoded without `Buffer`. Cursors keep the same base64url format, so cursors issued before the upgrade still work.
