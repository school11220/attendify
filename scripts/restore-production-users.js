// Recreate identities with verified emails and restore application metadata.
// Passwords, provider connections, and sessions are not migrated.
// Run only after saving an encrypted/restricted full user backup.
const fs = require('node:fs');
const { createClerkClient } = require('@clerk/backend');

async function main() {
  const sourcePath = process.env.ATTENDIFY_USER_BACKUP;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!sourcePath || !secretKey?.startsWith('sk_live_')) throw new Error('A private backup path and Production secret environment variable are required');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  if (!Array.isArray(source)) throw new Error('Expected a full Backend API user-list backup');
  const client = createClerkClient({ secretKey });
  const { data: existing, totalCount } = await client.users.getUserList({ limit: 100 });
  if (totalCount > 100) throw new Error('Paginate the Production inventory before restoring users');
  // Validate all identities before making any changes.
  const emails = new Set();
  for (const user of source) {
    const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
    if (primary?.verification?.status !== 'verified') throw new Error('Every source primary email must already be verified');
    const email = primary.email_address.toLowerCase();
    if (emails.has(email)) throw new Error('Duplicate source identity');
    emails.add(email);
    const target = existing.find(u => u.emailAddresses.some(e => e.emailAddress.toLowerCase() === email));
    if (target && target.externalId !== user.id) throw new Error('An existing Production identity requires manual review; no data overwritten');
    if (target && JSON.stringify(target.privateMetadata) !== JSON.stringify(user.private_metadata)) throw new Error('Existing Production metadata differs; no data overwritten');
  }
  if (!process.argv.includes('--apply')) {
    console.log(`Validated ${source.length} identities. Run with --apply to recreate missing accounts and restore metadata.`);
    return;
  }
  let restored = 0;
  for (const user of source) {
    if (existing.some(u => u.externalId === user.id)) continue;
    const primary = user.email_addresses.find(e => e.id === user.primary_email_address_id);
    const target = await client.users.createUser({
      emailAddress: [primary.email_address],
      firstName: user.first_name || undefined,
      lastName: user.last_name || undefined,
      username: user.username || undefined,
      externalId: user.id,
      skipPasswordRequirement: true,
      privateMetadata: user.private_metadata,
      publicMetadata: user.public_metadata,
      unsafeMetadata: user.unsafe_metadata,
    });
    if (JSON.stringify(target.privateMetadata) !== JSON.stringify(user.private_metadata)) throw new Error('Restored metadata verification failed');
    restored++;
  }
  console.log(`Restored ${restored} Production identities with their metadata. Development users were not changed.`);
}
main().catch(error => {
  // Provider messages can contain personal information; log codes only.
  console.error('Restoration stopped:', error.errors?.map(e => e.code).join(', ') || (error.errors ? 'provider_error' : error.message));
  process.exitCode = 1;
});
