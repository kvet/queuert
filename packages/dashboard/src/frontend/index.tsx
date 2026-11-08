import { Navigate, Route, Router, useSearchParams } from "@solidjs/router";
/* @refresh reload */
import { type Component, Show } from "solid-js";
import { render } from "solid-js/web";

import { App } from "./App.tsx";
import { basePath } from "./base.ts";
import { ChainDetail } from "./pages/ChainDetail.tsx";
import { ChainList } from "./pages/ChainList.tsx";
import { Find } from "./pages/Find.tsx";
import { JobDetail } from "./pages/JobDetail.tsx";
import { JobList } from "./pages/JobList.tsx";
import { Overview } from "./pages/Overview.tsx";
import { ChainTypes, JobTypes } from "./pages/Types.tsx";
import { WorkerDetail } from "./pages/WorkerDetail.tsx";
import { WorkerList } from "./pages/WorkerList.tsx";
import { theme } from "./state/theme.ts";

import "./styles/index.css";

const redirectIds = (List: Component) => () => {
  const [searchParams] = useSearchParams();
  const ids = () => searchParams.ids as string | undefined;
  return (
    <Show when={ids()} fallback={<List />}>
      {(value) => <Navigate href={`/find?ids=${encodeURIComponent(value())}`} />}
    </Show>
  );
};

theme.init();

render(
  () => (
    <Router base={basePath} root={App}>
      <Route path="/" component={Overview} />
      <Route path="/chains/types" component={ChainTypes} />
      <Route path="/chains" component={redirectIds(ChainList)} />
      <Route path="/chains/:id" component={ChainDetail} />
      <Route path="/jobs/types" component={JobTypes} />
      <Route path="/jobs" component={redirectIds(JobList)} />
      <Route path="/jobs/:id" component={JobDetail} />
      <Route path="/workers" component={WorkerList} />
      <Route path="/workers/:id" component={WorkerDetail} />
      <Route path="/find" component={Find} />
    </Router>
  ),
  document.getElementById("root")!,
);
