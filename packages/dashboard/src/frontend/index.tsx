import { Route, Router } from "@solidjs/router";
/* @refresh reload */
import { render } from "solid-js/web";

import { App } from "./App.js";
import { basePath } from "./base.js";
import { ChainDetail } from "./components/ChainDetail.js";
import { ChainList } from "./components/ChainList.js";
import { JobDetail } from "./components/JobDetail.js";

import "./styles/index.css";
import { JobList } from "./components/JobList.js";

render(
  () => (
    <Router base={basePath} root={App}>
      <Route path="/" component={ChainList} />
      <Route path="/chains/:id" component={ChainDetail} />
      <Route path="/jobs" component={JobList} />
      <Route path="/jobs/:id" component={JobDetail} />
    </Router>
  ),
  document.getElementById("root")!,
);
