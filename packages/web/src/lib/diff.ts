export type DiffMark = "same" | "changed";

/**
 * Line-level LCS diff. Returns, for each side, whether the line survives
 * unchanged on the other side. Inputs here are small (a single file or prompt).
 */
export function lineDiff(a: string, b: string): { left: DiffMark[]; right: DiffMark[] } {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  const norm = (s: string) => s.trim();
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = norm(A[i]) === norm(B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left: DiffMark[] = new Array(n).fill("changed");
  const right: DiffMark[] = new Array(m).fill("changed");
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(A[i]) === norm(B[j])) {
      left[i++] = "same";
      right[j++] = "same";
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return { left, right };
}
