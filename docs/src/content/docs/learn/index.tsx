import { CardGrid, LinkCard } from "../../../components/mdx/Cards.tsx";
import { StepProgress } from "../../../components/tutorial/StepProgress.tsx";
import { goFurther, learnSteps, useItInYourApp } from "../../../data/learn.ts";
import { siteHref } from "../../../docs/href.ts";

export const meta = {
  title: "Learn",
  description:
    "Run a chain in your browser, then learn the basics of Queuert in about fifteen minutes.",
};

const Page = () => (
  <>
    <p>
      Each Basics step teaches one idea and ends with a short exercise that runs in your browser, so
      nothing needs installing. New to Queuert? Start with{" "}
      <a href={siteHref("/learn/what-is-queuert/")}>What is Queuert</a>.
    </p>

    <h2>Basics</h2>
    <StepProgress steps={learnSteps} />

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
