import DOMPurify from "dompurify";
import { marked } from "marked";
export function renderRecap(markdown: string): string {
  const html = marked.parse(markdown, { async: false });
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "blockquote",
      "pre",
      "code",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    ALLOWED_ATTR: [],
  });
  // Foundry enriches journal HTML after rendering. Full-width delimiters remain inert through entity decoding.
  return safe.replaceAll("@", "＠").replaceAll("[", "［").replaceAll("]", "］");
}
