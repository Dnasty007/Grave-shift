/**
 * Verify the HYTOPIA dev server responds on HTTPS (same check the web client does).
 * Uses the SDK's self-signed cert — ignores TLS only for this diagnostic, not in-browser.
 */
import https from "node:https";

const port = process.env.PORT || "8080";
const host = process.env.CHECK_HOST || "localhost";
const url = `https://${host}:${port}/`;

const req = https.get(
  url,
  { rejectUnauthorized: false },
  (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      console.log(`GET ${url} -> HTTP ${res.statusCode}`);
      console.log(body);
      if (res.statusCode === 200 && body.includes('"status"')) {
        console.log(
          "\nOK: Game server is up. If the browser client still fails, trust the dev HTTPS cert in Chromium (see docs/LOCAL_CLIENT_PREVIEW.md — “If nothing works”)."
        );
        process.exit(0);
      }
      process.exit(1);
    });
  }
);

req.on("error", (err) => {
  console.error(`Cannot reach ${url}`);
  console.error(err.message);
  console.error("\nStart the server from grave-shift:  npm run dev");
  process.exit(1);
});
