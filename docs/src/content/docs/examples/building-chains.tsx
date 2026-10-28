import { ExampleDetail } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Building Chains",
  description: "Showcases for chain patterns, blockers, awaiting and workerless completion.",
};

const Page = () => (
  <>
    <p>
      Each showcase runs against PostgreSQL in Docker and prints what happens, scenario by scenario.
      Read one next to the guide it accompanies.
    </p>
    <h2 id="showcase-chain-patterns">Chain patterns</h2>
    <ExampleDetail name="showcase-chain-patterns" />
    <h2 id="showcase-blockers">Job blockers</h2>
    <ExampleDetail name="showcase-blockers" />
    <h2 id="showcase-chain-awaiting">Awaiting chains</h2>
    <ExampleDetail name="showcase-chain-awaiting" />
    <h2 id="showcase-workerless">Completing without a worker</h2>
    <ExampleDetail name="showcase-workerless" />
  </>
);

export default Page;
