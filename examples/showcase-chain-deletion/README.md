# Chain Deletion Showcase

Demonstrates deleting job chains with blocker safety checks and cascade deletion.

## Scenarios

1. **Simple Deletion**: Delete a completed chain
2. **Blocker Safety**: Deletion rejected when chain is referenced as a blocker
3. **Co-deletion**: Delete a chain together with its blocker
4. **Cascade Deletion**: Automatically resolve and delete transitive dependencies

## Running

```bash
pnpm install
pnpm start
```
