import { A } from "@solidjs/router";

import chainDetailShot from "../../../assets/dashboard/chain-detail.png";
import chainTypesShot from "../../../assets/dashboard/chain-types-list.png";
import chainsListShot from "../../../assets/dashboard/chains-list.png";
import chainDetailDarkShot from "../../../assets/dashboard/dark/chain-detail.png";
import chainTypesDarkShot from "../../../assets/dashboard/dark/chain-types-list.png";
import chainsListDarkShot from "../../../assets/dashboard/dark/chains-list.png";
import findDarkShot from "../../../assets/dashboard/dark/find.png";
import jobDetailDarkShot from "../../../assets/dashboard/dark/job-detail.png";
import jobTypesDarkShot from "../../../assets/dashboard/dark/job-types-list.png";
import jobsListDarkShot from "../../../assets/dashboard/dark/jobs-list.png";
import overviewDarkShot from "../../../assets/dashboard/dark/overview.png";
import workerDetailDarkShot from "../../../assets/dashboard/dark/worker-detail.png";
import workersListDarkShot from "../../../assets/dashboard/dark/workers-list.png";
import findShot from "../../../assets/dashboard/find.png";
import jobDetailShot from "../../../assets/dashboard/job-detail.png";
import jobTypesShot from "../../../assets/dashboard/job-types-list.png";
import jobsListShot from "../../../assets/dashboard/jobs-list.png";
import overviewShot from "../../../assets/dashboard/overview.png";
import workerDetailShot from "../../../assets/dashboard/worker-detail.png";
import workersListShot from "../../../assets/dashboard/workers-list.png";
import { ExampleCode } from "../../../components/ExampleCode.tsx";
import { ExampleRows } from "../../../components/ExampleList.tsx";
import { FieldList } from "../../../components/FieldList.tsx";
import { DashboardShot } from "../../../components/integrations/dashboard/DashboardShot.tsx";
import { ExperimentalAside } from "../../../components/integrations/ExperimentalAside.tsx";
import { Code } from "../../../components/mdx/Code.tsx";
import { Steps } from "../../../components/mdx/Steps.tsx";

export const meta = {
  title: "Dashboard",
  description: "Embeddable web UI for observing chains, jobs and workers.",
};

const Page = () => (
  <>
    <p>
      <code>@queuert/dashboard</code> provides an embeddable web UI for observing chains, jobs and
      workers. It mounts as a single <code>fetch</code> handler on your existing server — no
      external build steps or runtime dependencies beyond <code>queuert</code>.
    </p>

    <ExperimentalAside package="@queuert/dashboard" />

    <h2>Quick start</h2>
    <Steps>
      <ol>
        <li>
          <p>Install the package:</p>
          <Code lang="bash">{`npm install @queuert/dashboard`}</Code>
        </li>
        <li>
          <p>Create the dashboard with your Queuert client:</p>
          <ExampleCode example="dashboard" file="src/dashboard.ts" region="dashboard" />
        </li>
        <li>
          <p>Mount it on your server:</p>
          <ExampleCode example="dashboard" file="src/dashboard.ts" region="server" />
          <p>
            When mounting at a sub-path, set <code>basePath</code>:
          </p>
          <ExampleCode example="dashboard" file="src/dashboard-mounted.ts" region="base-path" />
        </li>
      </ol>
    </Steps>
    <p>
      <code>createDashboard</code> accepts a Queuert <code>client</code> (created via{" "}
      <code>createClient</code>) and returns <code>{"{ fetch }"}</code> — a standard web{" "}
      <code>fetch</code> handler. Pass it to any server runtime (Node.js, Bun, Deno, etc.). The
      handler serves both the dashboard API and the pre-built frontend.
    </p>

    <h2>Configuration</h2>
    <FieldList
      title="createDashboard options"
      idPrefix="option"
      items={[
        {
          name: "client",
          chips: [{ label: "required", tone: "strong" }],
          meta: <code>Client</code>,
          description: (
            <>
              The Queuert client created with <code>createClient</code>.
            </>
          ),
        },
        {
          name: "basePath",
          meta: <code>string</code>,
          description: "The sub-path the dashboard is mounted at.",
        },
      ]}
    />

    <h2>What it provides</h2>
    <FieldList
      proseNames
      items={[
        {
          name: "Home page",
          description:
            "Warnings for lost worker leases and stranded job types, totals across all chain and job types and workers, and the busiest types of each kind.",
        },
        {
          name: "Chain and job types",
          description:
            "Every type with its per-status counts, filterable by status, and each job type's live workers with a warning when it has pending jobs and no live worker.",
        },
        {
          name: "Chain and job lists",
          description:
            "One type at a time, with status and role filters, sorting, and input and output previews on every row.",
        },
        {
          name: "Chain detail",
          description:
            "The chain's jobs in sequence, the blockers each job waited on, and the jobs in other chains that wait on this chain.",
        },
        {
          name: "Job detail",
          description: "Input, output, the last error, attempt info, and the continuation link.",
        },
        {
          name: "Workers",
          description:
            "Every worker with its job types, concurrency and lease, and the jobs running under each.",
        },
        {
          name: "Find by ID or type",
          description:
            "Look up any chain, job or worker by ID, or jump to a chain or job type by name.",
        },
      ]}
    />
    <p>
      Supports a small set of mutations (running a scheduled job now, deleting a chain) in addition
      to read queries.
    </p>

    <h2>Authentication</h2>
    <p>
      The dashboard does not include authentication or authorization. To restrict access, add
      middleware before the dashboard handler:
    </p>
    <ExampleCode example="dashboard" file="src/dashboard-mounted.ts" region="auth" />

    <h2>Content Security Policy</h2>
    <p>
      The frontend uses no inline scripts, no <code>eval</code> and no external resources, so a CSP
      without <code>unsafe-eval</code> works. The favicon is a <code>data:</code> URI, so{" "}
      <code>img-src</code> must allow <code>data:</code>.
    </p>

    <h2>UI views</h2>
    <p>
      The top bar shows the dashboard's version next to the logo, which opens the home page, and
      holds the navigation (Chains, Jobs, Workers), <strong>Find by ID or type</strong> (
      <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd>), a theme switch (System, Light, Dark) and a link to these
      docs. Every filter lives in the URL, so any view can be bookmarked or shared.
    </p>

    <h3>Home page</h3>
    <DashboardShot
      light={overviewShot}
      dark={overviewDarkShot}
      alt="Home page with a lost-lease warning, chain and job status bars, worker counts and the busiest chain and job types"
    />
    <p>
      The home page (<code>/</code>), opened by the logo. A warning at the top counts the workers
      that lost their lease, linking to the worker list, and another counts the job types with
      pending jobs and no live worker, linking to the job types with pending jobs. The status panel
      shows a bar per kind with the totals of every status across all types: running and completed
      chains; blocked, pending, running and completed jobs; and a Workers row with the number of
      live and expired workers.
    </p>
    <p>
      Two lists show the five chain types with the most running chains and the five job types with
      the most unfinished (blocked, pending or running) jobs. Types with none of that work are left
      out; each row shows a chip for every status with a non-zero count, completed included, and
      each job type its workers chip. Counts stop at the state adapter's{" "}
      <A href="/api/core/type-aliases/stateadapterconfig/">
        <code>countCap</code>
      </A>{" "}
      (10,000 by default) per type and status, so a total that includes a capped count is shown as a
      lower bound (<code>≥</code>).
    </p>

    <h3>Chain and job types</h3>
    <DashboardShot
      light={chainTypesShot}
      dark={chainTypesDarkShot}
      alt="Chain types with a chip per status"
    />
    <DashboardShot
      light={jobTypesShot}
      dark={jobTypesDarkShot}
      alt="Job types with a chip per status and each type's live workers"
    />
    <p>
      <code>/chains/types</code> and <code>/jobs/types</code> list the types by name, one row each:
      the name and a chip for each status with a non-zero count, which links to the list filtered by
      that status. A count with a trailing <code>+</code> (e.g. <code>10,000+</code>) is capped.
      Next to a job type's name, a chip counts the live and expired workers that process the type
      and links to the worker list filtered by it. A type with pending jobs and no live worker gets
      a warning chip instead, and a type with no workers and no pending jobs gets no chip. The same
      status filter as the lists (All plus each status, with the number of types that have anything
      in it) narrows the page to the types with chains or jobs in that status and shows only that
      status's chip.
    </p>

    <h3>Chain list</h3>
    <DashboardShot
      light={chainsListShot}
      dark={chainsListDarkShot}
      alt="Chain list with the status and role filter bar and input previews"
    />
    <p>
      Lists the chains of one type, newest first by default; the selector next to the title switches
      to another chain type. A filter bar holds the status filter (All, Running, Completed, each
      with its count) and, on the right, a role select that narrows the list to independent chains
      or to chains used as blockers, next to the sort options, which depend on the selected status.
      Each row shows the status, chain ID and time, with one-line input and output previews below.
      More rows load as you scroll.
    </p>

    <h3>Chain detail</h3>
    <DashboardShot
      light={chainDetailShot}
      dark={chainDetailDarkShot}
      alt="Chain detail with the chain input and output"
    />
    <p>
      Shows one chain with its jobs as a vertical sequence, oldest first. Each job shows its status,
      the last error and attempt count if it was rescheduled after an error (with a{" "}
      <strong>Run now</strong> button while the next attempt is still scheduled), and the blocker
      chains it waits on (or waited on) with a "done / total" count. Expand <strong>Details</strong>{" "}
      to see a job's input and, for the tail job, its output. Runs of three or more repeated
      completed jobs of the same type are folded into one item that can be expanded.
    </p>
    <p>
      While the chain runs, its header names the current job and that job's status, since a running
      chain may be waiting on a blocked or pending job. The page reads top to bottom: the chain's
      details, its input, its output once it completes, <strong>Blocked jobs</strong>, and the
      chain's jobs. <strong>Blocked jobs</strong> lists jobs in other chains that declared this
      chain as a blocker. Those jobs keep that reference even after they finish, and a chain cannot
      be deleted while any job still references it: the delete dialog says so up front and names the
      job whose chain must be deleted first.
    </p>

    <h3>Job list</h3>
    <DashboardShot
      light={jobsListShot}
      dark={jobsListDarkShot}
      alt="Job list with the status filter bar and input previews"
    />
    <p>
      Lists the jobs of one type, with a filter bar holding the status filter (All, Blocked,
      Pending, Running and Completed, each with its count) and the sort options. Each row links to
      the job and to its chain (as "#2 of chain-type · chain-id"), links a running job's worker, and
      shows one-line input and, for a tail job, output previews. A warning icon marks an unfinished
      job whose last attempt failed; hover it for the error. Timing, attempts and the full error
      live on the job's page.
    </p>

    <h3>Job detail</h3>
    <DashboardShot
      light={jobDetailShot}
      dark={jobDetailDarkShot}
      alt="Job detail with the job input and output"
    />
    <p>
      Shows one job, top to bottom: its attempts and timing, the current attempt's worker, linked to
      its page, with its start time and its deadline while it runs, or the worker that completed it,
      its last error if any, input, the job it continued to or its output, and the blocker chains it
      waited on. A pending job scheduled in the future gets a <strong>Run now</strong> button that
      makes it due immediately; a failure is reported under the button.
    </p>

    <h3>Worker list</h3>
    <DashboardShot
      light={workersListShot}
      dark={workersListDarkShot}
      alt="Worker list with the job type select and a worker whose lease is lost"
    />
    <p>
      <code>/workers</code> lists every worker, oldest first, including a worker whose lease is gone
      and that was not reclaimed yet. A job type select narrows the list to the workers that process
      that type. Each row shows the worker's ID, how many jobs it runs out of its concurrency, when
      it started, and its job types, with a warning icon once its lease is lost. More rows load as
      you scroll.
    </p>

    <h3>Worker detail</h3>
    <DashboardShot
      light={workerDetailShot}
      dark={workerDetailDarkShot}
      alt="Worker detail with the worker's lease, concurrency and running job"
    />
    <p>
      Shows one worker: its ID, start time, lease end, concurrency, running job count, and its job
      types, each linking to that type's running jobs. A worker that lost its lease gets a notice.{" "}
      <strong>Running jobs</strong> lists the jobs running under the worker, loading more as you
      scroll. A worker is removed when it stops or when its lease is reclaimed and no history is
      kept, so a worker with no row shows as not found, still listing the jobs left running under it
      until a reclaim takes them.
    </p>

    <h3>Find by ID or type</h3>
    <DashboardShot
      light={findShot}
      dark={findDarkShot}
      alt="Find dialog listing the chain and job types that match the typed text"
    />
    <p>
      Press <kbd>⌘K</kbd> (<kbd>Ctrl+K</kbd>) or click the find box (a search icon on narrow
      screens) and type part of a type name or paste one or more IDs. While the text could be a type
      name, the dialog lists up to five matching chain types and five matching job types. Matching
      works like <a href="https://github.com/junegunn/fzf">fzf</a>: a name matches when it contains
      the text's letters in order (<code>ordval</code> finds <code>order:validate</code>), words
      separated by spaces must all match in any order, and text with an uppercase letter is
      case-sensitive; the best matches come first. Press <kbd>↓</kbd> to move into them and{" "}
      <kbd>Enter</kbd> to open that type's chain or job list; <kbd>Enter</kbd> in the box also opens
      the top type when no chain, job or worker has that ID.
    </p>
    <p>
      To look up by ID, paste one or more IDs, separated by commas, spaces or new lines (up to 100).
      A single ID opens the chain, job or worker directly; a chain and its head job share an ID, and
      when several items match you choose which to open. Several IDs open <code>/find</code>, which
      lists the matching chains, jobs and workers and the IDs that were not found.
    </p>

    <h2>Examples</h2>
    <ExampleRows title="Examples" names={["dashboard"]} />
  </>
);

export default Page;
