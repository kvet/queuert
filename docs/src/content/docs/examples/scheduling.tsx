import { ExampleDetail } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Scheduling",
  description: "Showcase for recurring jobs, deduplication and rescheduling.",
};

const Page = () => (
  <>
    <p>
      The showcase runs against PostgreSQL in Docker and prints what happens, scenario by scenario.
      Read it next to the Scheduling and Deduplication guides.
    </p>
    <h2 id="showcase-scheduling">Scheduling</h2>
    <ExampleDetail name="showcase-scheduling" />
  </>
);

export default Page;
