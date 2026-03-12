// ---------------------------------------------------------------------------
// AC Parser — extracts individual acceptance criteria from free-text.
//
// Jira acceptance criteria come in many formats:
// - Checkbox lists: [ ] User can do X / [x] System validates Y
// - Numbered lists: 1. User can do X
// - Bullet lists: - User can do X / * User can do X
// - BDD: Given X, When Y, Then Z
// - Plain paragraphs separated by newlines
//
// The parser does best-effort splitting. If it can't identify structure,
// it returns the whole text as a single criterion — the AI handles the rest.
// ---------------------------------------------------------------------------

/**
 * Extract individual acceptance criteria from free-text.
 * Returns an array of criterion strings, trimmed and non-empty.
 */
export function parseAcceptanceCriteria(text: string): string[] {
  if (!text || !text.trim()) return [];

  const trimmed = text.trim();

  // Try structured formats first (most specific to least specific)
  const checkboxes = tryCheckboxFormat(trimmed);
  if (checkboxes.length > 1) return checkboxes;

  const numbered = tryNumberedFormat(trimmed);
  if (numbered.length > 1) return numbered;

  const bullets = tryBulletFormat(trimmed);
  if (bullets.length > 1) return bullets;

  const bdd = tryBddFormat(trimmed);
  if (bdd.length > 0) return bdd;

  // Fall back to paragraph splitting
  const paragraphs = tryParagraphFormat(trimmed);
  if (paragraphs.length > 1) return paragraphs;

  // Last resort: return the whole text as one criterion
  return [trimmed];
}

// ---------------------------------------------------------------------------
// Format-specific parsers
// ---------------------------------------------------------------------------

/** Checkbox format: [ ] or [x] or [X] prefixed lines */
function tryCheckboxFormat(text: string): string[] {
  const lines = text.split('\n');
  const criteria: string[] = [];
  let buffer = '';

  for (const line of lines) {
    const match = line.match(/^\s*\[[ xX]?\]\s*(.+)/);
    if (match) {
      if (buffer) criteria.push(buffer.trim());
      buffer = match[1].trim();
    } else if (buffer && line.trim()) {
      // Continuation line
      buffer += ' ' + line.trim();
    }
  }
  if (buffer) criteria.push(buffer.trim());

  return criteria.filter(Boolean);
}

/** Numbered format: 1. or 1) prefixed lines */
function tryNumberedFormat(text: string): string[] {
  const lines = text.split('\n');
  const criteria: string[] = [];
  let buffer = '';

  for (const line of lines) {
    const match = line.match(/^\s*\d+[.)]\s*(.+)/);
    if (match) {
      if (buffer) criteria.push(buffer.trim());
      buffer = match[1].trim();
    } else if (buffer && line.trim()) {
      buffer += ' ' + line.trim();
    }
  }
  if (buffer) criteria.push(buffer.trim());

  return criteria.filter(Boolean);
}

/** Bullet format: - or * or • prefixed lines */
function tryBulletFormat(text: string): string[] {
  const lines = text.split('\n');
  const criteria: string[] = [];
  let buffer = '';

  for (const line of lines) {
    const match = line.match(/^\s*[-*•]\s+(.+)/);
    if (match) {
      if (buffer) criteria.push(buffer.trim());
      buffer = match[1].trim();
    } else if (buffer && line.trim()) {
      buffer += ' ' + line.trim();
    }
  }
  if (buffer) criteria.push(buffer.trim());

  return criteria.filter(Boolean);
}

/** BDD format: Given/When/Then blocks treated as complete scenarios */
function tryBddFormat(text: string): string[] {
  // Split on "Given" keyword at line start — each Given starts a new scenario
  const scenarios = text.split(/(?=^\s*given\b)/im);
  const criteria: string[] = [];

  for (const scenario of scenarios) {
    const trimmed = scenario.trim();
    if (!trimmed) continue;
    // Only include if it actually contains Given/When/Then structure
    if (/\bgiven\b/i.test(trimmed) && /\b(?:when|then)\b/i.test(trimmed)) {
      criteria.push(trimmed);
    }
  }

  return criteria;
}

/** Paragraph format: double-newline separated blocks */
function tryParagraphFormat(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 5); // Skip very short fragments
}
