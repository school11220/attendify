# Synced calendar exceptions and account controls

Calendar → choose a subject → select a date:

- **Mark as Holiday** excludes regular classes for all subjects on that date.
- **Cancel classes for this subject** excludes all that subject's classes on that date.
- Restore/remove either exception using the same control. Weekends alone do not cancel scheduled classes.
- Historical records and counters are unchanged by calendar edits. Delete an incorrect historical record explicitly. Normal present/absent marking is rejected on excluded dates, including API calls and automatic or bulk marking. **Extra** remains available for a class that actually took place.
- Calendar exceptions persist in the authenticated Clerk user's private metadata and load on another device or when returning to the calendar tab. Existing browser-only holidays are imported only after explicit confirmation; they are not silently assigned to an arbitrary account on a shared device.

Profile → **Privacy and account controls**:

- Location-assisted attendance and class-reminder switches sync to the account. Browser permissions are separate and must be changed in browser settings.
- Remove saved college location without deleting attendance or timetable.
- Clear only Attendify-owned local/session storage, asset caches and class reminders in this browser. Clerk authentication and unrelated browser storage are retained. Downloaded exports and data in other browsers are not removed.
- **DELETE MY DATA** clears entered profile, subjects, histories, timetable, college coordinates and calendar exceptions; turns automation/reminders off; retains the Clerk sign-in account and unrelated metadata.
- **DELETE MY ACCOUNT** permanently deletes the authenticated Clerk user and its stored metadata. No client-supplied target user ID is used. Provider deletion failures are not reported as success.
- Both deletion endpoints require same-origin requests, verified authentication, exact typed confirmation and verification within ten minutes. Older sessions receive a sign-out/sign-in prompt. Legacy tokens without factor-age claims qualify only if Clerk verifies the session itself was created within ten minutes.
- Export a JSON backup before deletion. Account deletion does not promise erasure of downloaded files, another device's browser data, or provider operational logs.

Storage and compatibility:

- Existing `privateMetadata.attendify` attendance data is preserved.
- `privateMetadata.attendify_calendar` stores exceptions separately. Date-keyed metadata patches avoid replacing other dates or subjects when independent devices edit calendar entries.
- `privateMetadata.attendify_settings` stores account-level automation preferences. Defaults preserve existing behavior until changed; notification permission is requested only from the user-triggered profile control.
- JSON exports include `calendar` and `settings`. New exports round-trip both; older imports without those fields preserve existing account exceptions/preferences. Invalid calendar dates and references are rejected before applying imports.
- New empty accounts are no longer written merely by reading them. Clerk throttling is retried only for rejected HTTP 429 responses, with bounded waits honoring short Retry-After values. Other provider/network errors are not blindly retried.

Validation:

- `npm test` exercises public/protected routes, account isolation, date validation, exceptions and attendance counts, backup compatibility, narrow metadata changes, concurrent independent date edits, deletion confirmation/origin/freshness checks, and provider failures.
- Authenticated browser verification uses disposable QA users only. Existing user metadata is compared before/after and temporary accounts are removed. This is application authentication testing through Clerk tickets; it does not verify Google OAuth branding or Google end-to-end login.
