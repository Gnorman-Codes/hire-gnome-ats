# Admin Area

## What This Module Is For
Admin Area controls platform-level configuration, access, diagnostics, and operational safety.

## Main Areas
- System Settings
- Data Import
- Data Export
- Users
- Divisions
- Skills
- Custom Fields
- Closer Gnome
- API Keys
- API Errors

## System Settings
Configuration includes:
- Site name and logo
- Theme preset
- Public careers hero headline/body copy
- Career site enabled/disabled
- Client review portal enabled/disabled
- API keys (Google, OpenAI)
- Bullhorn API credentials for background export jobs
- SMTP/email configuration
- Storage configuration (S3/local fallback)
- Demo mode visibility/lock behavior
- System diagnostics and test email tools
- Recent inbound email event visibility inside diagnostics

When demo mode is enabled:
- the branding card remains editable and saveable
- integrations, SMTP/email delivery, and object storage stay read-only

Layout:
- `Branding`, `Platform Settings`, and `Diagnostics` are split into separate tabs to reduce crowding
- `Branding` uses its own save action
- `Platform Settings` groups integrations, email delivery, and object storage under a separate save action
- `Diagnostics` now also includes a destructive operational-data purge flow with typed-word confirmation

Inbound email diagnostics includes:
- Postmark webhook activity for `/api/inbound/postmark`
- Processing status (`Processed`, `No Match`, `Failed`)
- Candidate/contact match counts
- Notes created
- Candidate files saved
- Attachment skip reasons for troubleshooting metadata-only or filtered attachments

Operational purge:
- Available in `System Settings > Diagnostics`
- Deletes operational ATS records and migration artifacts while preserving users, divisions, system settings, skills, custom field definitions, and zip codes
- Requires administrator access
- Requires a generated confirmation word to be typed exactly before the purge will run

## Data Import
Supports:
- Hire Gnome exports
- Generic CSV migration batches with per-column field mapping
- Bullhorn CSV migration batches
- Zoho Recruit CSV migration batches

Import workflow:
- Upload source file
- For generic CSV, add one or more files to the migration batch or upload one ZIP containing the CSV set
- For Bullhorn, add one or more CSV files to the batch or upload one ZIP containing the Bullhorn CSV set
- For Zoho Recruit, add one or more CSV files to the batch or upload one ZIP containing the Zoho Recruit CSV set
- Choose entity profile per CSV file when needed
- Map CSV columns into ATS fields when using the generic CSV source
- Preview creates, updates, skips, relationship warnings, row-level actions, and match reasons by entity
- Apply import

Generic CSV batches run in dependency order:
1. Clients
2. Contacts
3. Candidates
4. Job Orders
5. Submissions
6. Interviews
7. Placements

Bullhorn CSV batches run in dependency order:
1. Custom Fields
2. Clients
3. Contacts
4. Candidates
5. Job Orders
6. Submissions
7. Interviews
8. Placements

Zoho Recruit CSV batches run in dependency order:
1. Clients
2. Contacts
3. Candidates
4. Job Orders
5. Submissions
6. Interviews
7. Placements

Sample files:
- `docs/import-samples/generic-migration-batch/`
- Includes a clean demo-ready seven-file batch that shows cross-file relationship linking.
- `docs/import-samples/generic-migration-batch-messy/`
- Includes a second seven-file batch with messier legacy column names for mapping and migration demos.
- `docs/import-samples/bullhorn-batch/`
- Includes a clean Bullhorn-style batch for ZIP/manual batch testing across custom fields, clients, contacts, candidates, job orders, submissions, interviews, placements, and candidate resume/file payloads.
- `docs/import-samples/zoho-recruit-batch/`
- Includes a clean seven-file Zoho Recruit-style batch for ZIP/manual batch testing across clients, contacts, candidates, job orders, submissions, interviews, and placements.
- `docs/import-samples/hire-gnome-export/`
- Includes a sample Hire Gnome export ZIP payload for testing the native import path.

UI support:
- Each import source type includes a direct sample download link in the upload area.
- ZIP-based modes download a ZIP-ready sample batch that includes the README and sample files.

## Data Export
Use Data Export for:
- Full snapshot export
- Incremental date-range export
- Optional audit trail export
- Optional API error log export
- Bullhorn API batch ZIP export for date-bounded migration samples

Formats:
- JSON
- NDJSON
- ZIP (per-entity files)

Bullhorn export:
- Save Bullhorn API credentials in `System Settings > Platform Settings`
- Choose `Updated From` / `Updated To`
- Estimate changed Bullhorn core-row counts for the selected date window before starting the export job
- Choose a per-entity changed-row sample limit
- Choose whether candidate files/resumes should be included
- Queue a background export job and review it from the Bullhorn export jobs list
- Download the finished ZIP or open it in the import preview flow once the job completes
- Cancel queued or running Bullhorn export jobs from the list after confirmation
- Delete completed, cancelled, or failed Bullhorn export jobs from the list after confirmation
- Generate an import-ready ZIP containing:
  - `custom field definitions`
  - `clients`
  - `contacts`
  - `contact notes`
  - `candidates` (including structured candidate skills)
  - `candidate notes`
  - `candidate education`
  - `candidate work history`
  - `candidate files/resumes`
  - `job orders`
  - `submissions`
  - `interviews`
  - `placements`
- Upstream dependency records are expanded automatically so related records still link when the ZIP is imported
- Bullhorn export/import preserves custom field definitions and record-level custom field values when Bullhorn exposes them
- Bullhorn export/import also preserves candidate notes, candidate education, candidate work history, contact notes, and structured candidate skills when Bullhorn exposes them
- Bullhorn ZIP batches can also carry candidate attachment files, including resumes, and import them after the related candidates are created or updated
- Bullhorn and Zoho import/export operations can be disabled entirely with environment variables when needed

## Users
Admins can:
- Create/deactivate users
- Assign roles
- Assign divisions
- Trigger password resets and account access changes

## Divisions
Defines organizational boundaries and collaboration mode:
- Collaborative
- Owner Only

## Skills
Maintains standardized selectable skill options used by candidate records and matching.

## Custom Fields
Admins can define additional fields for:
- Candidates
- Clients
- Contacts
- Job Orders
- Submissions
- Interviews
- Placements

## Closer Gnome

In **Admin Area → Closer Gnome**, select **Generate Token** and copy the address
and token into **Admin → Hire Gnome Connection** in Closer. Select **Save
Connection**, then **Test Connection** in Closer. Enable **Allow Closer Gnome to
sync changes to Hire Gnome** in Hire Gnome for deal handoff and two-way sync.
For linked sign-in, paste the callback URL shown in Closer into **Sign-in
callback URL** in Hire Gnome and save.

Hire Gnome shows the connection token once. **Replace Token** invalidates the
current token immediately, so copy the replacement into Closer to reconnect.
See the [Closer Gnome workflow](../../README.md#closer-gnome-integration).

## API Keys

In **Admin Area → API Keys**, administrators can create read-only or read/write
keys for a director or recruiter and revoke them individually. See the
[API setup guide](../integration-api-v1.md#manage-api-keys) and
[Postman collection](../integration-api-v1.postman_collection.json).

## API Errors
Operational error visibility for diagnostics and support.

## Best Practice
1. Lock down admin access to trusted operators only.
2. Keep integration credentials current.
3. Review errors regularly.
4. Use test email mode in non-production environments.
