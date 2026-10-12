# Attendify Google sign-in production handoff

Audited 12 October 2026. Production Backend API access is now available. Google project `attendify-511417` and Clerk Production callback `https://clerk.attendify.justshivamm.in/v1/oauth_callback` were supplied through the owning dashboards. All five supplied Clerk CNAMEs now match authoritative DNS. Certificate deployment, Google credential/publication checks and a confirmed public contact still require completion. The original configuration below records the pre-cutover state.

## Verified current configuration

- App: Attendify. Existing logo: `public/logo.png`.
- Canonical origin/homepage: https://attendify.justshivamm.in
- Privacy: https://attendify.justshivamm.in/privacy
- Terms: https://attendify.justshivamm.in/terms
- Authorized Google domain: `justshivamm.in` (the registrable parent).
- Hosting: existing Vercel project `attendify`, ID `prj_cApS2rU9EGqO0K0A5lo6n3gYevdq`.
- Hosting Git connection: `school11220/attendify`, production branch `main`. The supplied checkout originally points to `shivam2931120/attendify`; its HEAD contains additional attendance fixes descended from the hosting repository's HEAD.
- Live Clerk: Development, `bright-moray-2.clerk.accounts.dev`, instance `ins_3A0oBd75QkneiUVApTg7RwwTLF7`.
- Two existing users have respectively 2/5 subjects and 2/14 timetable slots. No identities or attendance contents are included here.
- Observed Google client: `787459168867-0v2orf3qo56uocsi84iroseoahhuovdm.apps.googleusercontent.com`. This is Clerk's shared development client, not a client to edit in your production Google project.
- Observed Google redirect: `https://clerk.shared.lcl.dev/v1/oauth_callback`. Provider says “continue to Clerk”. Scopes are `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`.
- Application OAuth completion route: `https://attendify.justshivamm.in/sso-callback`. This is not Google's authorized redirect URI.
- DNS: Hostinger (`ns1.dns-parking.com`, `ns2.dns-parking.com`; SOA `dns.hostinger.com`). App CNAME points to `c0421d2f5bef2ea9.vercel-dns-017.com`.
- Authoritative queries found no CNAME at `clerk.attendify.justshivamm.in` or `accounts.attendify.justshivamm.in`. These are absent, not mismatched. Production records have not been supplied by Clerk, so their expected targets and other record names are unknown.
- No DMARC TXT or CAA answer was observed at the parent zone. Do not delete or weaken any DMARC policy if the console shows one or a subsequent query finds one.
- Connected Clerk CLI account can access other applications, but does not list Attendify. Existing Backend API secret accesses this Development instance only. Google Cloud CLI can list projects; none is named Attendify and the dedicated OAuth project is not identified. No usable Hostinger DNS connector was found.

## Preserve users and data before cutover

Every API route requires a verified Clerk user ID and passes that ID to DataService. Attendance data is in `privateMetadata.attendify`. No Organization roles, memberships, custom paid-role permissions, event assignments, payments or webhooks exist in this repository. Do not add roles or delete console roles based on another application's configuration. Signed-in users need no assigned role to use Attendify or its policies.

A Clerk Production instance is a separate user store. Cloning settings is not proof of user/data migration. Before changing hosting keys:

1. Obtain access to the owning Attendify Clerk application; sign the CLI into that account or grant access. Select Attendify, not another app with existing production credentials.
2. Inventory and securely back up the two Development users and all private/public metadata. Keep backups outside Git and logs, encrypted or in restricted storage. Verify attendance counts, histories, settings and timetable references before/after.
3. Clerk does not support direct Development-to-Production user migration. Recreate Production identities using existing verified email addresses and restore application metadata; passwords, sessions and external provider connections do not transfer. `scripts/restore-production-users.js` validates a restricted full user-list backup, requires a Production secret through the environment and defaults to a dry run. Set `ATTENDIFY_USER_BACKUP` to the backup path and run `node scripts/restore-production-users.js --apply` only after reviewing the dry run. It preserves complete private/public/unsafe metadata, records the original user ID as `externalId`, and refuses to overwrite conflicting existing accounts. Existing users must authenticate again and connect Google to the recreated identity. Preserve nested subject IDs referenced by timetable slots.
4. Validate each migrated user can authenticate and read the expected private attendance data in Production before cutover. Retain Development users as a rollback source. Do not delete users or Organization roles as part of branding.
5. The previous repository tracked `.env.vercel`. It has been removed from the current Git tree and `.env*` is ignored. Rotate the exposed Development secret in the owning Clerk console, securely update the existing Vercel environments and local ignored files, and redeploy. Removing a file does not remove it from prior Git history. Do not rewrite shared history without coordinating it.

## Clerk Production and Hostinger DNS

1. Clerk Dashboard → Attendify → instance selector → Create production instance → clone current settings. Set owned application domain `attendify.justshivamm.in`.
2. Production → Domains: copy every exact Name and Target shown. These instance-specific records cannot safely be inferred from another app.
3. Hostinger hPanel → Domains → `justshivamm.in` → DNS / Nameservers → DNS records. For each Clerk CNAME, remove only the suffix `.justshivamm.in` from its fully qualified name to obtain the **Name** field. Example: if Clerk supplies `clerk.attendify.justshivamm.in`, enter `clerk.attendify`. If it supplies `accounts.attendify.justshivamm.in`, enter `accounts.attendify`. Keep the exact supplied Target as **Target**. DKIM and mail names must be converted the same way, not guessed. Use CNAME, default TTL, DNS only if the provider exposes a proxy toggle. Preserve unrelated records and valid DMARC policies.
4. Query both authoritative nameservers for each exact record. No answer/NXDOMAIN means missing; an answer pointing elsewhere means incorrect. Check CAA eligibility for Let's Encrypt/Google Trust Services if issuance fails. Do not delete unrelated CAA policies without checking their purpose.
5. Clerk → Domains → verify DNS, then deploy certificates. Clerk documents DNS propagation may take up to 48 hours.
6. Set Production application name `Attendify`, upload existing logo, set Home `/`, Sign in `/sign-in`, Sign up `/sign-up`, after sign-in/up `/`, privacy `/privacy`, terms `/terms` using the canonical HTTPS origin. Reconfigure paths and social connections explicitly; those do not all copy from Development.

## Google OAuth and branding

1. Google Cloud Console → select/create a dedicated Attendify production project. Confirm the operator's public support and developer-contact email; never substitute a discovered account email without confirmation. The selected support address must be selectable under Google's account/Group rules.
2. Google Auth Platform → Audience → External. After configuration, click **Publish app** so status is In production. This makes the app available publicly; it does not publish approved branding.
3. Google Auth Platform → Branding → App name `Attendify`; upload the application's logo (prepare a square version if Google's uploader requires it); enter the exact homepage/privacy/terms links above, confirmed support/developer contacts, and authorized domain `justshivamm.in`.
4. Search Console → property selector → Add property → **Domain** → `justshivamm.in` → Continue. Use a Google account that owns/edits the Cloud project. Copy Google's exact TXT value. Hostinger parent zone → TXT → Name `@` → value copied from Search Console → Save. Return to Search Console → Verify. Preserve the TXT record. A project owner/editor must also be a verified domain owner; transfer/add the appropriate ownership if these are different accounts.
5. Clerk Production → SSO connections / Google → enable Google → custom credentials. Copy the **exact Authorized Redirect URI displayed by this Production instance**. It remains unknown until this instance is accessible; do not use the observed shared Development callback or guess its value.
6. Google Auth Platform → Clients → Web application client. Authorized JavaScript origins: `https://attendify.justshivamm.in` (no path). Authorized redirect URIs: the exact value from step 5. Google's redirect goes to Clerk; `/sso-callback` is the application's subsequent completion route.
7. Copy this Client ID and Client secret into the same Clerk Production Google connection and Save. Compare the entire Client ID in both consoles. Keep the secret out of Git, chat, command arguments and logs. Scope list should contain only the three observed basic identity scopes listed above; no Gmail/Drive/Calendar scopes are needed.
8. Keep test OAuth clients in a separate development project. Do not include unowned `clerk.accounts.dev`, `clerk.shared.lcl.dev`, or shared `vercel.app` domains in production branding verification. Audit all clients in the production project for leftover development redirect domains; move development configuration to a separate project without deleting working resources blindly.
9. Branding → **Verify Branding**. Fix reported issues or request manual review if needed. Automatic review usually takes minutes; manual review usually takes 2–3 business days. Avoid editing draft branding during verification.
10. When status becomes **Ready to publish**, click **Publish branding** within **7 days**. Approval alone does not update the consent screen. Monitor support/developer email for Google's requests.

## Vercel cutover and acceptance

- Current deployed compatibility changes intentionally retain the existing Development key pair. They do not claim production branding is complete.
- Production environment only: matching `CLERK_PUBLISHABLE_KEY=pk_live_…`, `CLERK_SECRET_KEY=sk_live_…` from Attendify Production; `APP_URL=https://attendify.justshivamm.in`; `PUBLIC_CONTACT_EMAIL` set only to the confirmed contact. Keep Preview/Development on separate matching Development keys and environment-specific URLs. Never print secret values.
- The Express application also accepts `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` when `CLERK_PUBLISHABLE_KEY` is unset. The server secret has no public-prefixed alias. Split a shared Vercel secret variable's targets into Development/Preview before adding a separate sensitive Production secret.
- If Clerk's owned frontend hostname fails its HTTPS handshake, complete Clerk Production Overview → verify DNS → Deploy certificates before promoting the Vercel deployment. `vercel --prod --skip-domain` can prepare a Production release without replacing working public authentication; promote after HTTPS becomes healthy.
- There is no webhook endpoint or webhook database sync in this app; no webhook production migration is needed for its implemented functionality.
- Redeploy the existing Vercel project after environment changes. Check runtime-generated `/auth/clerk.js` points to the production frontend, public policy links, custom sign-in/up, callbacks, protected pages and all APIs. Do not embed credentials in HTML besides the intentionally public publishable key.
- Browser: click Continue with Google; inspect only `client_id`, `redirect_uri`, `scope` and provider error fields, excluding state/session tokens. Confirm the production Client ID and exact Clerk callback; complete authentication using an authorized test identity, check both migrated users' records, and verify user isolation and signed-in role-less policy access.
- Starting a Google redirect is not an authenticated end-to-end login test.

Official references checked on 12 October 2026:

- https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google
- https://clerk.com/docs/guides/development/deployment/production
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://support.google.com/cloud/answer/15549049
- https://support.google.com/webmasters/answer/9008080
