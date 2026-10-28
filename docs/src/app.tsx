import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense, onMount } from "solid-js";

import { SearchDialog } from "./components/Search.tsx";
import { TopBar } from "./components/TopBar.tsx";

import "./styles/app.css";
import { theme } from "./theme.ts";

const App = () => {
  onMount(theme.init);

  return (
    <Router
      base={import.meta.env.SERVER_BASE_URL.replace(/\/$/, "")}
      root={(props) => (
        <MetaProvider>
          <Title>Queuert</Title>
          <TopBar />
          <Suspense>{props.children}</Suspense>
          <SearchDialog />
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
};

export default App;
