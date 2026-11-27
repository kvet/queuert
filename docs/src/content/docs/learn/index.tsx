import { CardGrid, LinkCard } from "../../../components/mdx/Cards.tsx";
import { StepProgress } from "../../../components/tutorial/StepProgress.tsx";
import {
  type LearnStep,
  goFurther,
  learnGroups,
  learnSteps,
  useItInYourApp,
} from "../../../data/learn.ts";
import { siteHref } from "../../../docs/href.ts";

export const meta = {
  title: "Learn",
  description:
    "Learn Queuert's guarantees in about ten minutes and its chain shapes in ten more, with exercises that run on PostgreSQL or SQLite in your browser.",
};

const StepGroup = (props: { group: LearnStep["group"] }) => {
  const group = learnGroups.find((candidate) => candidate.id === props.group)!;
  const steps = learnSteps.filter((step) => step.group === props.group);
  const minutes = steps.reduce((total, step) => total + step.minutes, 0);
  return (
    <>
      <p>
        {group.intro} About {minutes} minutes.
      </p>
      <StepProgress steps={steps} first={learnSteps.indexOf(steps[0]) + 1} />
    </>
  );
};

const Page = () => (
  <>
    <p>
      Each step teaches one idea and ends with a short exercise. The exercises run on a real
      database inside your browser, PostgreSQL through PGlite or SQLite through sql.js, so nothing
      needs installing. New to Queuert? Start with{" "}
      <a href={siteHref("/learn/what-is-queuert/")}>What is Queuert</a>.
    </p>

    <h2>Essentials</h2>
    <StepGroup group="essentials" />

    <h2>Shaping chains</h2>
    <StepGroup group="shaping-chains" />

    <p>
      Ready to use it in a project?{" "}
      <a href={siteHref(`/${useItInYourApp.slug}/`)}>{useItInYourApp.title}</a> installs Queuert
      with your database and migrates the schema.
    </p>

    <h2>Go further</h2>
    <CardGrid>
      {goFurther.map((guide) => (
        <LinkCard
          title={guide.title}
          href={siteHref(`/${guide.slug}/`)}
          description={guide.summary}
        />
      ))}
    </CardGrid>
  </>
);

export default Page;
