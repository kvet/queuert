export const jsonPreview = (data: unknown): string => {
  if (data == null) return "";
  const json = JSON.stringify(data);
  return json.length > 80 ? json.slice(0, 77) + "..." : json;
};
