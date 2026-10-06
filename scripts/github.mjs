export async function githubGet(
  endpoint,
  {
    repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY,
    token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    fetchImpl = fetch,
    allowMissing = false,
  } = {},
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error("Set GH_REPO to owner/repository");
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/${endpoint}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Norc-upstream-check",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw new Error(`GitHub API failed: HTTP ${response.status} (${endpoint})`);
  return response.json();
}
