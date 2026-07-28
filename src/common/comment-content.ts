import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a"];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer",
      target: "_blank",
    }),
  },
};

/** Strip scripts and unsafe markup; keep basic rich-text tags only. */
export function sanitizeCommentContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  return sanitizeHtml(trimmed, SANITIZE_OPTIONS);
}

/** Plain text for previews, mention parsing, and length checks. */
export function commentPlainText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  return sanitizeHtml(trimmed, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeCommentHtml(content: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(content);
}
