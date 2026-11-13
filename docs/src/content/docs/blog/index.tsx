import { PostList } from "../../../components/blog/PostList.tsx";

export const meta = {
  title: "Blog",
  description:
    "Essays on the problems behind durable background work and the patterns that solve them.",
};

const Page = () => (
  <>
    <p>
      Longer reads on the problems that background work runs into once it has to survive crashes,
      retries and two systems disagreeing — and the patterns that solve them. They explain ideas
      rather than an API; the guides cover how to use them in Queuert.
    </p>
    <PostList />
  </>
);

export default Page;
