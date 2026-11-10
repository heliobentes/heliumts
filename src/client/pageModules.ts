import type { ComponentType } from "react";

import type { PageRoute } from "../runtime/pageRoutes.js";
import type { LayoutProps } from "./routerManifest.js";

type ClientPageModule = PageRoute & {
    file: string;
    page: { default?: ComponentType<unknown> };
    layouts: { default?: ComponentType<LayoutProps> }[];
    preload: () => Promise<{ default: ComponentType<unknown> }>;
};

// Vite replaces this module for the browser. Plain Node imports need no page modules.
export const pageModules: ClientPageModule[] = [];
