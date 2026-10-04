import { formatAbsolute, formatRelative } from "../domain/time.js";
import { now } from "../state/clock.js";

/** Relative time from the shared clock, with the absolute local date-time in `title`. */
export const Time = (props: { date: Date; class?: string }) => {
  return (
    <time
      datetime={props.date.toISOString()}
      title={formatAbsolute(props.date)}
      class={props.class}
    >
      {formatRelative(props.date, now())}
    </time>
  );
};
