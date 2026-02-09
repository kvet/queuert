# @queuert/tsconfig

Shared TypeScript configuration for the Queuert monorepo.

## Usage

### For examples and internal utilities

Extend from the base configuration:

```json
{
  "extends": "@queuert/tsconfig/base",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### For published packages

Use the package configuration which includes `isolatedDeclarations`:

```json
{
  "extends": "@queuert/tsconfig/package",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

## Exports

| Export                      | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| `@queuert/tsconfig/base`    | Base configuration for all projects                                   |
| `@queuert/tsconfig/package` | Extends base with `isolatedDeclarations: true` for published packages |

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
