export const renderHtml = (htmlContent: string, basePath: string): string => {
  const baseHref = basePath ? basePath + "/" : "/";
  return htmlContent.replace("<head>", `<head><base href="${baseHref}" />`);
};
