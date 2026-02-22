const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

export function TimeAgo(props: { date: Date }) {
  const fmt = () => {
    const sec = Math.round((props.date.getTime() - Date.now()) / 1000);
    for (const [unit, threshold] of units) {
      if (Math.abs(sec) >= threshold) return rtf.format(Math.round(sec / threshold), unit);
    }
    return rtf.format(sec, "second");
  };

  return <time datetime={props.date.toISOString()}>{fmt()}</time>;
}
