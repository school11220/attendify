require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { clerkMiddleware, getAuth } = require("@clerk/express");
const app = express();
const key = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const secret = process.env.CLERK_SECRET_KEY || "";
const configured = Boolean(key && secret);
if (configured && key.startsWith("pk_live_") !== secret.startsWith("sk_live_")) {
  throw new Error("Clerk publishable and secret keys must belong to the same environment");
}
const frontend = key ? Buffer.from(key.split("_").slice(2).join("_"), "base64").toString().replace(/\$$/, "") : "";
if (frontend && !/^[a-z0-9.-]+$/.test(frontend)) throw new Error("Invalid Clerk frontend hostname");
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
const origins = [process.env.APP_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  process.env.VERCEL_ENV !== "production" && "http://localhost:3000"].filter(Boolean);
if (configured) app.use(clerkMiddleware({ publishableKey: key, ...(origins.length ? { authorizedParties: origins } : {}) }));
else app.use((req, _res, next) => { req.auth = () => ({ userId: null }); next(); });
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const signedIn = req => configured && Boolean(getAuth(req).userId);
function render(res, file) {
  const contact = process.env.PUBLIC_CONTACT_EMAIL;
  const contactHtml = contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)
    ? `<a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a>`
    : "A public support contact has not yet been configured. These policy pages will be updated when the operator confirms it.";
  res.set("Cache-Control", "no-store").type("html").send(fs.readFileSync(path.join(__dirname, file), "utf8").replaceAll("{{CONTACT}}", contactHtml));
}
app.get("/auth/clerk.js", (_req, res) => {
  res.set("Cache-Control", "no-store").type("application/javascript");
  if (!configured) return res.send('window.attendifyAuthReady = Promise.reject(new Error("Sign-in is temporarily unavailable.")); window.attendifyAuthReady.catch(() => {});');
  res.send(`window.attendifyAuthReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.crossOrigin = 'anonymous'; script.dataset.clerkPublishableKey = ${JSON.stringify(key)};
    script.src = ${JSON.stringify('https://' + frontend + '/npm/@clerk/clerk-js@5/dist/clerk.browser.js')};
    script.onload = () => window.Clerk.load({ signInUrl: '/sign-in', signUpUrl: '/sign-up', signInFallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' }).then(() => resolve(window.Clerk), reject);
    script.onerror = () => reject(new Error('Unable to load sign-in. Please try again.'));
    document.head.appendChild(script);
  }); window.attendifyAuthReady.catch(() => {});`);
});
app.use("/api", require("./routes/api"));
app.get(["/privacy", "/privacy-policy"], (_req, res) => render(res, "views/privacy.html"));
app.get(["/terms", "/terms-of-service"], (_req, res) => render(res, "views/terms.html"));
app.get(["/sign-in", "/sign-up", "/sso-callback"], (_req, res) => render(res, "views/auth.html"));
app.get("/", (req, res) => render(res, signedIn(req) ? "public/index.html" : "views/home.html"));
const pages = { "/dashboard": "index.html", "/subjects": "subjects.html", "/analytics": "analytics.html", "/index.html": "index.html", "/calendar": "calendar.html", "/calculator": "calculator.html", "/profile": "profile.html", "/subject-details": "subject-details.html" };
for (const [route, file] of Object.entries(pages)) {
  app.get([route, ...(!route.endsWith('.html') && route !== '/dashboard' ? [route + '.html'] : [])], (req, res) => {
    if (!signedIn(req)) return res.redirect('/sign-in');
    render(res, 'public/' + file);
  });
}
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.use((_req, res) => res.status(404).type('text').send('Page not found'));
app.use((err, _req, res, _next) => {
  console.error("Attendify request failed:", err.name, err.status, err.errors?.map(error => error.code));
  res.status(500).json({ error: "The request could not be completed. Please try again." });
});
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log("Attendify server ready"));
module.exports = app;
