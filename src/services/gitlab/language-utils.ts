// ---------------------------------------------------------------------------
// Language detection utilities — maps file extensions to languages and
// computes per-language line-change breakdowns from GitLab diffs.
//
// Design decisions:
// - Extension-based detection only (no content analysis). Fast and sufficient
//   for the preview use case — we just need a rough breakdown.
// - Colors sourced from GitHub's linguist project for visual consistency.
// - Only the top ~35 languages are mapped. Unmapped extensions fall into
//   "Other" with a neutral gray color.
// - For renamed files, we use new_path (the current name) for detection.
// - Binary files or files with empty diffs contribute 0 lines.
// - The breakdown is sorted descending by linesChanged so the UI can
//   render segments left-to-right without re-sorting.
// ---------------------------------------------------------------------------

import type { GitLabDiffFile } from '@/types/gitlab';
import type { LanguageBreakdown } from '@/types/mr-preview';

// ---------------------------------------------------------------------------
// Extension → Language mapping
// ---------------------------------------------------------------------------

type LanguageInfo = {
  name: string;
  color: string;
};

const EXTENSION_MAP: Record<string, LanguageInfo> = {
  // JavaScript / TypeScript
  '.js': { name: 'JavaScript', color: '#f1e05a' },
  '.jsx': { name: 'JavaScript', color: '#f1e05a' },
  '.mjs': { name: 'JavaScript', color: '#f1e05a' },
  '.cjs': { name: 'JavaScript', color: '#f1e05a' },
  '.ts': { name: 'TypeScript', color: '#3178c6' },
  '.tsx': { name: 'TypeScript', color: '#3178c6' },
  '.mts': { name: 'TypeScript', color: '#3178c6' },
  '.cts': { name: 'TypeScript', color: '#3178c6' },

  // Web
  '.html': { name: 'HTML', color: '#e34c26' },
  '.htm': { name: 'HTML', color: '#e34c26' },
  '.css': { name: 'CSS', color: '#563d7c' },
  '.scss': { name: 'SCSS', color: '#c6538c' },
  '.sass': { name: 'Sass', color: '#a53b70' },
  '.less': { name: 'Less', color: '#1d365d' },
  '.vue': { name: 'Vue', color: '#41b883' },
  '.svelte': { name: 'Svelte', color: '#ff3e00' },

  // Python
  '.py': { name: 'Python', color: '#3572A5' },
  '.pyi': { name: 'Python', color: '#3572A5' },
  '.pyx': { name: 'Python', color: '#3572A5' },

  // Ruby
  '.rb': { name: 'Ruby', color: '#701516' },
  '.erb': { name: 'Ruby', color: '#701516' },
  '.rake': { name: 'Ruby', color: '#701516' },
  '.gemspec': { name: 'Ruby', color: '#701516' },

  // Go
  '.go': { name: 'Go', color: '#00ADD8' },

  // Rust
  '.rs': { name: 'Rust', color: '#dea584' },

  // Java / Kotlin
  '.java': { name: 'Java', color: '#b07219' },
  '.kt': { name: 'Kotlin', color: '#A97BFF' },
  '.kts': { name: 'Kotlin', color: '#A97BFF' },

  // C / C++ / C#
  '.c': { name: 'C', color: '#555555' },
  '.h': { name: 'C', color: '#555555' },
  '.cpp': { name: 'C++', color: '#f34b7d' },
  '.cc': { name: 'C++', color: '#f34b7d' },
  '.cxx': { name: 'C++', color: '#f34b7d' },
  '.hpp': { name: 'C++', color: '#f34b7d' },
  '.cs': { name: 'C#', color: '#178600' },

  // Swift / Objective-C
  '.swift': { name: 'Swift', color: '#F05138' },
  '.m': { name: 'Objective-C', color: '#438eff' },

  // PHP
  '.php': { name: 'PHP', color: '#4F5D95' },

  // Shell
  '.sh': { name: 'Shell', color: '#89e051' },
  '.bash': { name: 'Shell', color: '#89e051' },
  '.zsh': { name: 'Shell', color: '#89e051' },
  '.fish': { name: 'Shell', color: '#89e051' },

  // Config / Data
  '.json': { name: 'JSON', color: '#a0a0a0' },
  '.yaml': { name: 'YAML', color: '#cb171e' },
  '.yml': { name: 'YAML', color: '#cb171e' },
  '.toml': { name: 'TOML', color: '#9c4221' },
  '.xml': { name: 'XML', color: '#0060ac' },
  '.ini': { name: 'INI', color: '#d1dbe0' },

  // Markdown / Docs
  '.md': { name: 'Markdown', color: '#083fa1' },
  '.mdx': { name: 'MDX', color: '#083fa1' },
  '.rst': { name: 'reStructuredText', color: '#141414' },

  // SQL
  '.sql': { name: 'SQL', color: '#e38c00' },

  // Dart / Flutter
  '.dart': { name: 'Dart', color: '#00B4AB' },

  // Scala
  '.scala': { name: 'Scala', color: '#c22d40' },

  // Elixir / Erlang
  '.ex': { name: 'Elixir', color: '#6e4a7e' },
  '.exs': { name: 'Elixir', color: '#6e4a7e' },
  '.erl': { name: 'Erlang', color: '#B83998' },

  // Lua
  '.lua': { name: 'Lua', color: '#000080' },

  // R
  '.r': { name: 'R', color: '#198CE7' },
  '.R': { name: 'R', color: '#198CE7' },

  // Docker / Infra
  '.dockerfile': { name: 'Dockerfile', color: '#384d54' },
  '.tf': { name: 'HCL', color: '#844FBA' },
  '.hcl': { name: 'HCL', color: '#844FBA' },

  // GraphQL / Proto
  '.graphql': { name: 'GraphQL', color: '#e10098' },
  '.gql': { name: 'GraphQL', color: '#e10098' },
  '.proto': { name: 'Protocol Buffers', color: '#418167' },
};

const OTHER_LANGUAGE: LanguageInfo = { name: 'Other', color: '#8b8b8b' };

/**
 * Detect language from a file path based on its extension.
 * Also handles extensionless files like Dockerfile, Makefile, etc.
 */
export function detectLanguage(filePath: string): LanguageInfo {
  // Handle well-known extensionless files
  const basename = filePath.split('/').pop() ?? '';
  const lowerBasename = basename.toLowerCase();

  if (lowerBasename === 'dockerfile' || lowerBasename.startsWith('dockerfile.')) {
    return { name: 'Dockerfile', color: '#384d54' };
  }
  if (lowerBasename === 'makefile' || lowerBasename === 'gnumakefile') {
    return { name: 'Makefile', color: '#427819' };
  }

  // Extract extension (supports compound like .d.ts)
  const dotIndex = basename.indexOf('.');
  if (dotIndex === -1) return OTHER_LANGUAGE;

  // Try compound extension first (e.g., .d.ts, .spec.ts)
  const ext = basename.substring(dotIndex).toLowerCase();
  // For compound extensions, try the last part first
  const lastDotIndex = basename.lastIndexOf('.');
  if (lastDotIndex !== dotIndex) {
    const shortExt = basename.substring(lastDotIndex).toLowerCase();
    const match = EXTENSION_MAP[shortExt];
    if (match) return match;
  }

  return EXTENSION_MAP[ext] ?? OTHER_LANGUAGE;
}

/**
 * Count added and removed lines from a unified diff string.
 * Skips diff headers (---/+++ lines) and hunk headers (@@ lines).
 * Returns 0/0 for empty or binary diffs.
 */
export function countDiffLines(diff: string): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };

  let added = 0;
  let removed = 0;

  const lines = diff.split('\n');
  for (const line of lines) {
    // Skip empty lines at end of diff
    if (line.length === 0) continue;

    const firstChar = line[0];
    if (firstChar === '+') {
      // Skip the +++ header line
      if (line.startsWith('+++')) continue;
      added++;
    } else if (firstChar === '-') {
      // Skip the --- header line
      if (line.startsWith('---')) continue;
      removed++;
    }
    // Context lines (starting with space) and @@ hunk headers are ignored
  }

  return { added, removed };
}

/**
 * Compute a per-language breakdown of lines changed across all diff files.
 *
 * Groups files by detected language, sums added+removed lines per language,
 * computes percentages, and returns sorted descending by linesChanged.
 *
 * Files with 0 changed lines (binary files, empty diffs) are excluded.
 */
export function computeLanguageBreakdown(diffFiles: GitLabDiffFile[]): LanguageBreakdown[] {
  const langMap = new Map<string, { info: LanguageInfo; linesChanged: number }>();

  for (const file of diffFiles) {
    // Use new_path for language detection (current file name)
    const filePath = file.new_path || file.old_path;
    const lang = detectLanguage(filePath);
    const { added, removed } = countDiffLines(file.diff);
    const total = added + removed;

    if (total === 0) continue;

    const existing = langMap.get(lang.name);
    if (existing) {
      existing.linesChanged += total;
    } else {
      langMap.set(lang.name, { info: lang, linesChanged: total });
    }
  }

  const totalLines = Array.from(langMap.values()).reduce((sum, v) => sum + v.linesChanged, 0);
  if (totalLines === 0) return [];

  const breakdown: LanguageBreakdown[] = Array.from(langMap.values())
    .map(({ info, linesChanged }) => ({
      language: info.name,
      linesChanged,
      color: info.color,
      percentage: Math.round((linesChanged / totalLines) * 1000) / 10, // One decimal place
    }))
    .sort((a, b) => b.linesChanged - a.linesChanged);

  return breakdown;
}
