import { type Theme, createTheme, dashboardStorageKey } from "@queuert/ui/lib";

import { basePath } from "../base.ts";

export const theme: Theme = createTheme(dashboardStorageKey(basePath, "theme"));
