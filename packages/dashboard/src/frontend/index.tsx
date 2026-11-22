/* @refresh reload */
import { createRouter, useNavigate, useSearchParams } from "@solidjs/router";
import { render } from "@solidjs/web";
import { QueryClientProvider } from "@tanstack/solid-query";
import { type Component, Show, createEffect } from "solid-js";

import { App } from "./App.tsx";
import { appHref, basePath } from "./base.ts";
import { ChainDetail } from "./pages/ChainDetail.tsx";
import { ChainList } from "./pages/ChainList.tsx";
import { Find } from "./pages/Find.tsx";
import { JobDetail } from "./pages/JobDetail.tsx";
import { JobList } from "./pages/JobList.tsx";
import { Overview } from "./pages/Overview.tsx";
import { ChainTypes, JobTypes } from "./pages/Types.tsx";
import { WorkerDetail } from "./pages/WorkerDetail.tsx";
import { WorkerList } from "./pages/WorkerList.tsx";
import { queryClient } from "./state/queries.ts";
import { theme } from "./state/theme.ts";

import "./styles/index.css";

const redirectIds = (List: Component) => () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ids = () => searchParams.ids as string | undefined;
  createEffect(ids, (value) => {
    if (value) navigate(appHref(`/find?ids=${encodeURIComponent(value)}`), { replace: true });
  });
  return (
    <Show when={!ids()}>
      <List />
    </Show>
  );
};

const Router = createRouter({
  base: basePath,
  routes: [
    { path: "/", component: Overview },
    { path: "/chains/types", component: ChainTypes },
    { path: "/chains", component: redirectIds(ChainList) },
    { path: "/chains/:id", component: ChainDetail },
    { path: "/jobs/types", component: JobTypes },
    { path: "/jobs", component: redirectIds(JobList) },
    { path: "/jobs/:id", component: JobDetail },
    { path: "/workers", component: WorkerList },
    { path: "/workers/:id", component: WorkerDetail },
    { path: "/find", component: Find },
  ],
});

theme.init();

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Router>{(props) => <App>{props.children}</App>}</Router>
    </QueryClientProvider>
  ),
  document.getElementById("root")!,
);
