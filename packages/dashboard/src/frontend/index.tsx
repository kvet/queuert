import { Navigate, Route, Router } from "@solidjs/router";
/* @refresh reload */
import { render } from "solid-js/web";

import { App } from "./App.js";
import { basePath } from "./base.js";
import { ChainDetail } from "./components/ChainDetail.js";
import { ChainList } from "./components/ChainList.js";
import { ChainTypes } from "./components/ChainTypes.js";
import { JobDetail } from "./components/JobDetail.js";
import { JobList } from "./components/JobList.js";
import { JobTypes } from "./components/JobTypes.js";

import "./styles/index.css";

render(
  () => (
    <Router base={basePath} root={App}>
      <Route path="/" component={() => <Navigate href="/chains/types" />} />
      <Route path="/chains/types" component={ChainTypes} />
      <Route path="/chains" component={ChainList} />
      <Route path="/chains/:id" component={ChainDetail} />
      <Route path="/jobs/types" component={JobTypes} />
      <Route path="/jobs" component={JobList} />
      <Route path="/jobs/:id" component={JobDetail} />
    </Router>
  ),
  document.getElementById("root")!,
);
