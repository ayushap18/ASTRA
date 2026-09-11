export function sanitizeUtterance(raw: string): string {
  let text = raw.replace(/\r?\n+/g, " ");
  text = text.replace(/Bearer\s+\S+/gi, "");
  text = text.replace(/\bsk_[A-Za-z0-9_]+/g, "");
  text = text.replace(/\bghp_[A-Za-z0-9]+/g, "");
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "");
  text = text.replace(/\S*:\/\/[^/\s]*:[^@\s]*@[^\s]+/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 500) {
    text = text.slice(0, 500);
  }
  return text;
}
