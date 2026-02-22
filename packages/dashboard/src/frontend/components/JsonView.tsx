export function JsonView(props: { data: unknown }) {
  return (
    <pre class="json-view">{props.data != null ? JSON.stringify(props.data, null, 2) : "null"}</pre>
  );
}
