/* @refresh reload */
import { render } from "solid-js/web";
import { Route, Router } from "@solidjs/router";
import { App } from "./App.js";
import { ChainList } from "./components/ChainList.js";
import { ChainDetail } from "./components/ChainDetail.js";
import { JobList } from "./components/JobList.js";
import { JobDetail } from "./components/JobDetail.js";
import "./styles/index.css";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={ChainList} />
      <Route path="/chains/:id" component={ChainDetail} />
      <Route path="/jobs" component={JobList} />
      <Route path="/jobs/:id" component={JobDetail} />
    </Router>
  ),
  document.getElementById("root")!,
);
