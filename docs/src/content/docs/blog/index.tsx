import { PostList } from "../../../components/blog/PostList.tsx";

export const meta = {
  title: "Blog",
  description:
    "Essays on the problems behind durable background work and the patterns that solve them. They explain ideas rather than an API; the guides cover how to use them in Queuert.",
};

const Page = () => (
  <div class="[&>ol]:mt-0 [&>ol]:border-t-0">
    <PostList />
  </div>
);

export default Page;
