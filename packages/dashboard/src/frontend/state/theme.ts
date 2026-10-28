import { type Theme, createTheme } from "@queuert/ui/lib";

import { basePath } from "../base.js";
import { storageKey } from "./storage.js";

export const theme: Theme = createTheme(storageKey(basePath, "theme"));
