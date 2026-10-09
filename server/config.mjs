export function readConfig(env, site = {}) {
  const mode = env.MWA_MODE || "demo";
  if (!["demo", "live"].includes(mode)) throw new Error("MWA_MODE must be demo or live.");
  const host = env.HOST || "127.0.0.1";
  const port = Number(env.PORT || 3008);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT is invalid.");
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("HOST must be 127.0.0.1 or 0.0.0.0.");
  if (mode === "live" && (!env.MWA_API_KEY || host !== "127.0.0.1" || env.PUBLIC_ORIGIN)) {
    throw new Error("Live mode requires a server-side MWA_API_KEY and a loopback-only host, without PUBLIC_ORIGIN. Public hosting supports preview mode.");
  }
  let publicOrigin;
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new Error("PUBLIC_ORIGIN must be a clean HTTPS origin.");
    publicOrigin = url.origin;
  }
  if (host === "0.0.0.0" && !publicOrigin) throw new Error("Set PUBLIC_ORIGIN to your HTTPS demo URL for public hosting.");
  const repositoryUrl = env.GITHUB_REPOSITORY_URL || site.repositoryUrl || "";
  if (repositoryUrl && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(repositoryUrl)) throw new Error("Use a GitHub owner/repository URL.");
  const campaign = site.campaign || "music-starter";
  if (!/^[a-z0-9-]{1,64}$/.test(campaign)) throw new Error("Use a short lowercase campaign name.");
  return { mode, host, port, publicOrigin, repositoryUrl, campaign, apiKey: mode === "live" ? env.MWA_API_KEY : undefined };
}
