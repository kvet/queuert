# @queuert/tsconfig

Shared TypeScript configuration for the Queuert monorepo.

## Usage

```json
{
  "extends": "@queuert/tsconfig/base",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## Base Configuration

The base configuration includes:

- `target: "esnext"` - Latest ECMAScript features
- `module: "nodenext"` - Node.js ESM module system
- `moduleResolution: "nodenext"` - Node.js module resolution
- `noEmit: true` - Type checking only (builds use tsdown)
- `composite: true` - Project references support
- `strict: true` - Maximum type safety
- `isolatedModules: true` - Compatible with single-file transpilers
- `skipLibCheck: true` - Skip type checking of declaration files
