/** Highlights the command the way Shiki's bash grammar does: the program, then string words. */
export const commandHtml = (command: string) => {
  const [manager, ...words] = command.split(" ");
  return `<pre class="shiki queuert" style="background-color:var(--shiki-background);color:var(--shiki-foreground)"><code><span class="line"><span style="color:var(--shiki-token-function)">${manager}</span>${words
    .map((word) => `<span style="color:var(--shiki-token-string)"> ${word}</span>`)
    .join("")}</span></code></pre>`;
};
