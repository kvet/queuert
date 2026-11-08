import { type Theme, createTheme } from "@queuert/ui/lib";

import { basePath } from "../base.ts";
import { storageKey } from "./storage.ts";

export const theme: Theme = createTheme(storageKey(basePath, "theme"));
