/**
 * Two-row Levenshtein edit distance: O(min) memory instead of a full matrix.
 *
 * Shared by the indexer's fuzzy matching and the post-write hook
 * (hooks/symbol-check.mjs). Kept dependency-free on purpose: the hook runs on
 * every Write/Edit and must not pull in heavy native modules like ast-grep.
 */
export function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let j = 0; j <= a.length; j++) prev[j] = j;

  for (let i = 1; i <= b.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = Math.min(prev[j - 1], curr[j - 1], prev[j]) + 1;
      }
    }
    [prev, curr] = [curr, prev];
  }

  return prev[a.length];
}
