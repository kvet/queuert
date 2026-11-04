import { ExampleDetail } from "../../../components/ExampleList.tsx";

export const meta = {
  title: "Reliability",
  description: "Showcases for error recovery, error handling, timeouts and abort signals.",
};

const Page = () => (
  <>
    <p>
      Each showcase runs against PostgreSQL in Docker and makes jobs fail, stall or stop on purpose,
      so you can watch how the worker recovers.
    </p>
    <h2 id="showcase-error-recovery">Error recovery</h2>
    <ExampleDetail name="showcase-error-recovery" />
    <h2 id="showcase-error-handling">Error handling</h2>
    <ExampleDetail name="showcase-error-handling" />
    <h2 id="showcase-timeouts">Timeouts</h2>
    <ExampleDetail name="showcase-timeouts" />
    <h2 id="showcase-signals">Abort signals</h2>
    <ExampleDetail name="showcase-signals" />
  </>
);

export default Page;
