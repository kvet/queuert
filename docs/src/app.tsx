import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { Loading, onSettled } from "solid-js";
import { pageRoutes } from "virtual:file-routes";

import { restoreSyncedTabs } from "./components/mdx/Tabs.tsx";
import { SearchDialog } from "./components/Search.tsx";
import { TopBar } from "./components/TopBar.tsx";

import "./styles/app.css";
import { initStack } from "./stack.ts";
import { theme } from "./theme.ts";

const Router = createRouter({
  base: import.meta.env.BASE_URL.replace(/\/$/, ""),
  routes: fileRoutes(pageRoutes),
});

const App = () => {
  onSettled(() => {
    theme.init();
    initStack();
    restoreSyncedTabs();
  });

  return (
    <Router>
      {(props) => (
        <>
          <TopBar />
          <Loading>{props.children}</Loading>
          <SearchDialog />
        </>
      )}
    </Router>
  );
};

export default App;
