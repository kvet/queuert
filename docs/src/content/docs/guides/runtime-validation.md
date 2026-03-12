---
title: Runtime Validation
description: Add runtime validation with Zod, Valibot, TypeBox, or ArkType.
sidebar:
  order: 14
---

`defineJobTypeRegistry` provides compile-time type safety with zero runtime cost. When your job inputs originate from external sources (APIs, webhooks, user input), you can add runtime validation using any schema library.

Queuert's core is schema-agnostic — validation adapters are implemented in user-land using `createJobTypeRegistry`, which wraps schema libraries into the registry interface. Both approaches provide identical compile-time type safety; runtime validation adds protection against invalid external data.

See [Runtime Validation Integration](/queuert/integrations/runtime-validation/) for setup instructions, the adapter pattern, and complete examples with Zod, Valibot, TypeBox, and ArkType.
