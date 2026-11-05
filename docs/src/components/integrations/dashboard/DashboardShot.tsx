/**
 * One dashboard screenshot (800×640) in a plain 1px frame. Renders the light and the dark capture
 * and shows the one matching the site theme. The other is `display: none`, which already removes
 * it from the accessibility tree, so the alt text is read once in either theme. The fixed aspect ratio keeps the page from shifting while the image loads.
 */
export const DashboardShot = (props: { light: string; dark: string; alt: string }) => {
  const imageClass = "aspect-[5/4] h-auto w-full";
  return (
    <div class="my-4 overflow-hidden rounded-xs border border-border">
      <img
        src={props.light}
        alt={props.alt}
        width={800}
        height={640}
        loading="lazy"
        class={`block dark:hidden ${imageClass}`}
      />
      <img
        src={props.dark}
        alt={props.alt}
        width={800}
        height={640}
        loading="lazy"
        class={`hidden dark:block ${imageClass}`}
      />
    </div>
  );
};
