function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Closest name by normalized edit distance, or null if nothing is close
// enough to be a plausible suggestion rather than a coincidence.
export function suggestClosestName(name, candidates) {
  const key = name.toLowerCase();
  let best = null;
  let bestSimilarity = 0;
  for (const candidate of candidates) {
    const candKey = candidate.toLowerCase();
    const maxLen = Math.max(key.length, candKey.length) || 1;
    const similarity = 1 - levenshtein(key, candKey) / maxLen;
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      best = candidate;
    }
  }
  return bestSimilarity >= 0.6 ? best : null;
}
