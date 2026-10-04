import { Navigate, Route, Router, useSearchParams } from "@solidjs/router";
/* @refresh reload */
import { type Component, Show } from "solid-js";
import { render } from "solid-js/web";

import { App } from "./App.js";
import { basePath } from "./base.js";
import { ChainDetail } from "./pages/ChainDetail.js";
import { ChainList } from "./pages/ChainList.js";
import { Find } from "./pages/Find.js";
import { JobDetail } from "./pages/JobDetail.js";
import { JobList } from "./pages/JobList.js";
import { Overview } from "./pages/Overview.js";
import { ChainTypes, JobTypes } from "./pages/Types.js";
import { initTheme } from "./state/theme.js";

import "./styles/index.css";

/** Old `?ids=` list links moved to Find by ID; redirect (replace) so they keep working. */
const redirectIds = (List: Component) => () => {
  const [searchParams] = useSearchParams();
  const ids = () => searchParams.ids as string | undefined;
  return (
    <Show when={ids()} fallback={<List />}>
      {(value) => <Navigate href={`/find?ids=${encodeURIComponent(value())}`} />}
    </Show>
  );
};

initTheme();

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
      <Route path="/find" component={Find} />
    </Router>
  ),
  document.getElementById("root")!,
);
