export const normalizeMountPath = (pathname: string): string =>
  pathname
    .replace(/\/(?:chains|jobs)\/.*$/, "/")
    .replace(/\/+$/, "/")
    .replace(/[^a-zA-Z0-9/_.-]/g, "")
    .replace(/\/?$/, "/");

export const renderHtml = (htmlContent: string, mountPath: string, nonce?: string): string => {
  let content = htmlContent.replace("<head>", `<head><base href="${mountPath}" />`);
  if (nonce) {
    content = content
      .replace(/<script/g, `<script nonce="${nonce}"`)
      .replace(/<link/g, `<link nonce="${nonce}"`)
      .replace(/<style/g, `<style nonce="${nonce}"`);
  }
  return content;
};
