export function StatusBadge(props: { status: string }) {
  return (
    <span class="status-badge" data-status={props.status}>
      {props.status}
    </span>
  );
}
