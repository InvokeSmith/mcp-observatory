/**
 * Constraint 8, and conflict-of-interest control 3, as a build failure rather than a style note.
 *
 * The riskiest defect in this project is not a crash. It is a sentence: publishing a number that
 * reads as "X% of servers allow cross-tenant writes" when what was measured is a precondition.
 * Prose review does not reliably catch that, because the wrong sentence is the natural one to write.
 * So the rule is mechanical.
 */
import { readFile } from 'node:fs/promises';

export interface DisallowedRule {
  readonly id: string;
  readonly reason: string;
  readonly patterns: readonly string[];
}

export interface RequiredRule {
  readonly id: string;
  readonly reason: string;
  readonly appliesTo?: readonly string[];
  readonly pattern?: string;
  readonly orderedSections?: readonly string[];
}

export interface PublicationLanguageRules {
  readonly version: string;
  readonly disallowed: readonly DisallowedRule[];
  readonly required: readonly RequiredRule[];
}

export interface LintViolation {
  readonly ruleId: string;
  readonly reason: string;
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
}

export async function loadPublicationRules(
  path = 'protocol/publication-language.json',
): Promise<PublicationLanguageRules> {
  return JSON.parse(await readFile(path, 'utf8')) as PublicationLanguageRules;
}

export function lintArtifact(
  fileName: string,
  content: string,
  rules: PublicationLanguageRules,
): readonly LintViolation[] {
  const violations: LintViolation[] = [];
  const lines = content.split('\n');

  for (const rule of rules.disallowed) {
    for (const pattern of rule.patterns) {
      // Constructed per use. A shared /g regex carries lastIndex between calls and silently skips
      // matches, which for a linter means intermittently passing a file it should fail.
      const regex = new RegExp(pattern, 'i');
      for (const [index, line] of lines.entries()) {
        if (regex.test(line)) {
          violations.push({
            ruleId: rule.id,
            reason: rule.reason,
            file: fileName,
            line: index + 1,
            excerpt: line.trim().slice(0, 160),
          });
        }
      }
    }
  }

  for (const rule of rules.required) {
    if (rule.appliesTo !== undefined && !rule.appliesTo.includes(fileName)) continue;

    if (rule.pattern !== undefined && !new RegExp(rule.pattern, 'i').test(content)) {
      violations.push({
        ruleId: rule.id,
        reason: rule.reason,
        file: fileName,
        line: 0,
        excerpt: `required pattern /${rule.pattern}/ is absent`,
      });
    }

    if (rule.orderedSections !== undefined) {
      const positions = rule.orderedSections.map((section) =>
        content.search(new RegExp(`^#{1,6}\\s.*${section}`, 'im')),
      );
      const allPresent = positions.every((p) => p >= 0);
      const inOrder = positions.every((p, i) => i === 0 || p > (positions[i - 1] ?? -1));
      if (!allPresent || !inOrder) {
        violations.push({
          ruleId: rule.id,
          reason: rule.reason,
          file: fileName,
          line: 0,
          excerpt: `sections must appear in order: ${rule.orderedSections.join(' then ')}`,
        });
      }
    }
  }

  return violations.sort((a, b) =>
    a.ruleId !== b.ruleId ? (a.ruleId < b.ruleId ? -1 : 1) : a.line - b.line,
  );
}

export function formatViolations(violations: readonly LintViolation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line} [${v.ruleId}] ${v.excerpt}\n    why: ${v.reason}`)
    .join('\n');
}
