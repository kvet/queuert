/** Status badge for a job or a chain. */
export function StatusBadge(props: { status: string }) {
  return (
    <span class="status-badge" data-status={props.status}>
      {props.status}
    </span>
  );
}
