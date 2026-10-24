---
"@queuert/dashboard": patch
---

Rescheduling a job or deleting a chain from the dashboard notifies workers only after the change commits, so a worker woken by the notification no longer looks for the job before it is visible.
