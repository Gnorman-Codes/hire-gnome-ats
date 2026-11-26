# Hire Gnome ATS User Guide

This guide is for day-to-day users. It explains the core workflow and how each module fits together.

## 1) Core Workflow

Use this sequence as your default process:

1. Create or update a `Client`.
2. Create or update a `Contact` for that client.
3. Create a `Job Order` linked to the client and hiring manager contact.
4. Add or import a `Candidate`.
5. Create a `Submission` for candidate + job order.
6. Share the `Client Review Portal` from the job order when you want external client feedback without requiring client login.
7. Schedule one or more `Interviews`.
8. Convert successful submissions to `Placements`.
9. Use notes, activities, and administrator audit trail access for accountability where applicable.

## 2) Roles And Access

### Administrator
- Full access across all divisions.
- Can manage users, divisions, system settings, integrations, and diagnostics.
- Diagnostics also surfaces recent inbound email webhook events for troubleshooting.
- Administrators can purge operational ATS data from `Admin Area > System Settings > Diagnostics`, with a typed confirmation word required before the purge runs.
- Can reassign owners and divisions.

### Director
- Access to all records in their division.
- Can assign ownership to recruiters in the same division.

### Recruiter
- Access is controlled by division mode:
- `Collaborative` division: sees all records in that division.
- `Owner Only` division: sees records they own (plus records explicitly linked by workflow).
- Reporting is stricter: recruiters only see their own data in the `Reports` module.

## 3) Navigation Basics

- Left navigation: module list.
- Top search: global search across records.
- User menu (`top-right`): account settings, Help, and sign out.
- List pages: search, sorting, paging, and column chooser.
- `Job Orders` also includes a separate `Advanced Search` builder for structured criteria like date ranges and minimum submissions, without replacing the fast basic search box.
- `Candidates` also includes a separate `Advanced Search` builder for structured criteria like owner, source, skills, resume keywords, profile completeness, and activity thresholds, without replacing the fast basic search box.
- `Clients` also includes a separate `Advanced Search` builder for structured criteria like owner, status, notes volume, job-order volume, and last-activity dates, without replacing the fast basic search box.
- `Contacts` also includes a separate `Advanced Search` builder for structured criteria like client, owner, status, notes volume, job-order counts, and last-activity dates, without replacing the fast basic search box.
- `Submissions` also includes a separate `Advanced Search` builder for structured criteria like status, origin, submitter, client-portal visibility, and submitted/updated date ranges, without replacing the fast basic search box.
- `Interviews` also includes a separate `Advanced Search` builder for structured criteria like type, status, interviewer, location, and start-date ranges, without replacing the fast basic search box.
- `Placements` also includes a separate `Advanced Search` builder for structured criteria like placement type, compensation type, status, and offered/join/end date ranges, without replacing the fast basic search box.
- Column chooser keeps the default list layouts intact while letting users reveal extra optional columns per module, drag columns into a preferred order, and save those preferences to their user account so the same view follows them across devices.
- Saved views let you capture the current list state as a reusable named view, including filters, sort order, and column layout, apply it later, and set one saved view as your personal default per module.
- List tables sort ascending by the first column by default unless a saved view restores a different sort.
- Candidate names in list/table views are shown as `Last, First` anywhere candidate records are being sorted or scanned in a table.
- Detail pages: snapshot at top, editable form, workspace tabs for related records.
- Candidate, job order, and submission detail pages now include a unified `Timeline` inside the workspace, so recent recruiting activity is visible without opening multiple screens.
- Actions menu (`...`): context actions like archive, close, cancel, convert, and administrator-only audit access where supported.
- Administrators manage third-party credentials in [**Admin Area → API Keys**](integration-api-v1.md#manage-api-keys) and the CRM connection in [**Admin Area → Closer Gnome**](modules/admin-area.md#closer-gnome).
- `Admin Area > Data Import` now supports generic CSV, Bullhorn, and Zoho Recruit migration batches, so messy spreadsheet exports and ATS CSV exports can be staged, previewed, and applied in the correct relationship order.
- Bullhorn migration batches now preserve `customFieldDefinitions` and record-level custom field values when the source includes them.
- Bullhorn migration batches now also preserve candidate notes, candidate education, candidate work history, contact notes, and structured candidate skills when Bullhorn exposes them.
- Bullhorn ZIP batches can also carry candidate attachment files, including resumes, so candidate documents can migrate with the record data instead of being rebuilt manually.
- `Admin Area > Data Export` now also includes a Bullhorn API exporter that runs in the background, generates an import-ready Bullhorn batch ZIP from a bounded created/updated date range, and lets administrators download the finished batch or open it directly in the import preview flow from the completed job.
- Bullhorn export also supports a preflight estimate so administrators can see how many changed core records fall in the selected date window before starting a background run.
- Administrators can save Bullhorn API credentials in `Admin Area > System Settings > Platform Settings` so background exports do not require re-entering credentials each time, and each export can optionally include candidate resumes/files.
- Bullhorn background exports can be cancelled while queued or running.
- Each import source type now includes a direct sample download in the UI so you can test the flow without building your own files first.
- A clean demo/test batch lives in `docs/import-samples/generic-migration-batch/` if you want a ready-made set of CSV files for the generic import flow.
- A second sample set lives in `docs/import-samples/generic-migration-batch-messy/` if you want to demo mapping with more realistic legacy column names.
- A clean Bullhorn-style sample batch lives in `docs/import-samples/bullhorn-batch/` if you want to demo the Bullhorn ZIP/manual migration flow, including custom field definitions, note/education/work-history metadata, structured candidate skills, and values.
- That Bullhorn sample batch now also includes a candidate resume/file payload so file migration can be demonstrated in the same ZIP flow.
- A clean Zoho Recruit-style sample batch lives in `docs/import-samples/zoho-recruit-batch/` if you want to demo the Zoho ZIP/manual migration flow across clients, contacts, candidates, job orders, submissions, interviews, and placements.
- A sample Hire Gnome export ZIP lives in `docs/import-samples/hire-gnome-export/` and is also linked directly from the Hire Gnome import path in the UI.
- Generic CSV preview is now a real safety check, with tabbed per-entity creates/updates/skips, relationship warnings, row-level actions, and match reasons before you apply the import.
- Bullhorn imports now support the same batch preview/apply flow so related clients, contacts, candidates, job orders, submissions, interviews, and placements can be migrated together instead of one file at a time.
- Zoho Recruit imports now support the same batch preview/apply flow so related clients, contacts, candidates, job orders, submissions, interviews, and placements can be migrated together instead of one file at a time.

## Demo Environment Note

If you are using the public demo environment, the first authenticated login shows a one-time modal with quick guidance.

Important demo-specific behavior:
- Demo data is preloaded so you can move directly through candidate, job order, submission, interview, and placement flows.
- Demo data resets periodically.
- The demo admin can create API keys for the demo recruiter. Those keys are cleared when the demo recruiter is recreated at reset.
- Forwarding an email to `demo@hiregnome.com` triggers the inbound Postmark workflow.
- The forwarded message must contain an email address that matches an existing candidate or contact record.
- When it matches, Hire Gnome creates an email note on that record.
- Candidate matches can also receive file attachments from the inbound message.

## 4) Required Field Behavior

- Required fields show a red `*`.
- Save buttons stay disabled until required fields are valid.
- Email and URL fields are validated.
- Phone and currency fields auto-format while typing.
- Zip-based city/state inference is applied where configured.
- AI features show a disabled control plus a hint when OpenAI has not been configured in `Admin Area > System Settings`.

## 5) Module Guides

## Inbound Email Capture

Primary purpose:
- Turn inbound recruiting emails into structured candidate/contact history.

Behavior:
1. Postmark sends inbound email JSON to `/api/inbound/postmark`.
2. The system extracts email addresses from the payload.
3. If a `Candidate.email` or `Contact.email` matches, the system creates an `Email` note on that record.
4. Candidate matches can also receive file attachments from the inbound email.
5. Contact matches currently receive notes only, not file attachments.

What users will see:
- On candidate and contact detail views, inbound emails appear in Notes with `Email` note type styling.
- The note body is cleaned up to remove most forwarded-header junk, external caution banners, and quoted thread noise.
- On candidates, supported inbound attachments appear in the Files area when the email payload includes real attachment content.

Admin troubleshooting:
- `Admin Area > System Settings > System Diagnostics` shows recent inbound email events, match counts, notes created, files saved, and attachment skip reasons.
- `Admin Area > System Settings` branding controls also manage the public careers hero headline/body copy.

## Candidates

Primary purpose:
- Store candidate profile, resume, skills, history, and activity.

Common actions:
1. `Candidates > New Candidate`
2. Fill required identity fields.
3. Add status, source, owner, and current employment details.
4. Add notes, education, work history, and file attachments.
5. Use the candidate detail sparkles `AI Summary` header button to open the summary modal. If no summary exists yet, it generates automatically.
6. Use the candidate detail snapshot card to quickly review title, location, status, top skills, AI summary snippet, last activity, and profile completeness before submission.
7. Use the `Suggested Next Step` card on candidate detail for a timeline-aware recommendation such as `Review Resume`, `Submit To Job Order`, `Schedule Interview`, or `Follow Up On Offer`.
8. Use `Actions` for fast create:
- Add submission
- Add interview
- Add placement
- Draft email

Resume parsing:
- Choose upload or paste mode.
- System attempts AI parsing first if key is configured.
- Falls back to built-in parser if AI is unavailable.
- Parsed resumes can auto-populate candidate data and attach source file.
- In the candidate `Files` workspace, uploaded files can be labeled as the candidate's `Resume` for clearer internal review and to control which resume is exposed in the client portal.

AI summary:
- Opened from the candidate detail sparkles `AI Summary` header button.
- Generated on demand from the candidate profile, resume text, skills, education, work history, and recent notes.
- Opening the modal auto-generates the first summary when none exists.
- Stored separately from the resume field.
- Shows:
	- overview
	- strengths
	- concerns
	- suggested next step
- Can be refreshed from the modal.
- Matched job orders also support `Explain Match`, which stores a reusable explanation of fit, likely gaps, and what the recruiter should validate.

Profile completeness:
- Shown in the candidate snapshot card.
- Uses existing profile data to score recruiter readiness.
- Highlights top missing profile gaps like resume summary, skills, work history, education, resume attachment, and required custom fields.
- Also appears as a compact score chip on the candidates list.
- Use `Advanced Search` on the candidates list when quick lookup is not enough, for example `Resume Keywords contains kubernetes` plus `Profile Completeness >= 80`, or `Skills contains React` with `Last Activity Date in past 14 days`.
- Creating a submission from a low-completeness candidate shows a soft warning, but does not hard-block the workflow.

Duplicate handling:
- Candidate creation includes duplicate checks.
- Merge option is available when duplicate confidence is high.

Email drafting:
- Candidate actions include `Draft Email`.
- Choose purpose and tone, optionally add instructions, then generate a reusable draft.
- Copy the generated subject/body directly to the clipboard.
- If OpenAI is not configured, the action stays visible but disabled with a hint.

## Clients

Primary purpose:
- Track companies, ownership, status, and client-level notes/activity.

Common actions:
1. `Clients > New Client`
2. Set required fields including owner and status.
3. Add address and zip for location inference.
4. From client detail actions, create:
- New contact (client locked)
- New job order (client locked)

List workflow:
- Use `Advanced Search` on the clients list when quick lookup is not enough, for example `Status = Active` plus `Job Orders >= 3` or `Last Activity Date in past 30 days`.

## Contacts

Primary purpose:
- Track hiring-side people tied to clients.

Common actions:
1. `Contacts > New Contact`
2. Complete required fields:
- Name
- Email
- Mobile
- Source
- Owner
- Client
3. Add title, department, address, and notes.

Behavior notes:
- When creating from a client route, client is locked.
- For existing contact records, client is not editable.
- Contact actions include `Draft Email` for recruiter-facing outbound draft generation.
- If OpenAI is not configured, the action stays visible but disabled with a hint.
- Use `Advanced Search` on the contacts list when quick lookup is not enough, for example `Client = Atlas Test` plus `Job Orders >= 1` or `Last Activity Date in past 30 days`.

## Job Orders

Primary purpose:
- Define open requisitions and required qualifications.

Common actions:
1. `Job Orders > New Job Order`
2. Set required owner, status, client, and hiring manager contact.
3. Add internal description.
4. If career-site posting is enabled:
- Toggle publish on
- Add public description (required when publishing)

Submission workflow:
- Add submissions directly from job order detail workspace.
- Use `Priority Order` in the submissions workspace to rank submissions by recruiter preference.
- Drag and drop submissions while in `Priority Order` sort to persist the ranking.
- Candidate names in the submissions workspace open the candidate record; use the separate launch icon to open the submission record.
- The submissions workspace shows the latest client portal action/comment on each submission row for quick review.
- Career-site responses stay marked as `Web` and start hidden from the client portal until a recruiter promotes them from submission detail.
- Duplicate submissions for same candidate + job are blocked.
- Candidate suggestions use qualification scoring and typeahead safeguards.
- Candidate matches support `Explain Match`, which opens a saved AI explanation for why a candidate fits, where the gaps are, and what to validate before submitting.
- Use `Actions > Client Review Portal` to create, copy, email, open, revoke, or restore the persistent client-facing magic link for the assigned hiring contact, with portal analytics on job order detail and in the modal showing sent, opened, last viewed, and acted-on status.
- Sending the portal link from the modal uses a branded email invite that follows the selected theme, with a direct portal CTA and job context for the client contact.
- In the client portal, hiring managers can save structured scorecards for `Communication`, `Technical Fit`, `Culture Fit`, and `Overall Recommendation` alongside comments or interview/pass actions.
- If the client portal is disabled in `Admin Area > System Settings`, passive portal UI is hidden and the actions-menu entry will explain that an administrator must enable it.
- Use `Advanced Search` on the job-order list when the basic search is not enough, for example `closed in the past 30 days` plus `Submissions >= 4`.

## Submissions

Primary purpose:
- Track candidate delivery to job orders.

Common actions:
1. Create submission from candidate or job order flow.
2. Update status through lifecycle.
3. Use the `Client Write-Up` toolbar icons to generate or copy the AI write-up.
4. Use actions menu for:
- Convert to placement (with confirmation)
- Schedule interview
- [Send Submission by Email or Log Client Feedback](modules/submissions.md#send-a-submission-by-email)

Behavior notes:
- Candidate/job become locked after creation.
- If converted to placement, submission becomes non-editable.
- `Client Write-Up` can be AI-generated from the candidate and job order, then edited before saving.
- The write-up toolbar sits above the field and supports regenerate + copy to clipboard.
- `Client Feedback` on submission detail shows comments, structured scorecards, and actions received through the client review portal, including interview requests and passes.
- If the client uses `Pass`, the portal confirms the action first and then locks that submission against any further client responses.
- Client `Pass` actions also move that submission to the bottom of the job order's `Priority Order` ranking.
- The client portal only exposes the candidate's labeled primary resume. If no primary resume is set, the portal does not offer a file download.
- Submission detail includes a `Client Portal` visibility field plus actions to `Promote to Client Portal` or `Hide from Client Portal`.
- Submission detail also includes a `Submission Packet` action that opens a print-friendly internal packet for browser PDF export.
- Use `Advanced Search` on the submissions list when quick lookup is not enough, for example `Origin = Web` plus `Client Portal = Hidden` or `Submitted At in past 14 days`.

## Interviews

Primary purpose:
- Schedule and coordinate interview events.

Common actions:
1. Create interview from submission or interview list.
2. Required fields:
- Interviewer
- Interviewer email
- Start date/time
3. Set duration; end time auto-calculates.
4. Set type (`Phone`, `Video`, `In Person`) and location.
5. Add optional participants and optional video link.
6. Use `Interview Questions` to generate a saved question set from the candidate and job order context.

Calendar + email behavior:
- `.ics` generation is available from interview actions.
- Invite emails are sent on create/update when email config exists.
- In test mode, all emails route to `EMAIL_TEST_RECIPIENT`.
- Status `Completed` does not trigger invite update emails.
- Cancel interview action requires confirmation and marks status accordingly.
- `Interview Questions` are generated on demand, saved on the record, editable, and can be refreshed or copied later.
- Use `Advanced Search` on the interviews list when quick lookup is not enough, for example `Type = Video` plus `Starts At in past 7 days`.

## Placements

Primary purpose:
- Track accepted and non-accepted placement outcomes.

Common actions:
1. Convert from submission or create manually.
2. Select compensation type and placement type.
3. Enter required compensation fields based on selected type.
4. Set start/end dates and status.
5. Track recruiter and sales commission splits on the placement itself, with each role totaling 100%.

Status behavior:
- `Accepted` locks the core placement package, but commission tracking remains editable.
- Actions include withdraw/cancel with confirmation and reason capture.
- Use `Advanced Search` on the placements list when quick lookup is not enough, for example `Placement Type = Perm` plus `Compensation Type = Salary` or `Expected Join in past 30 days`.

## Archive

Primary purpose:
- Soft-delete flow for safe record cleanup and restore.

Common actions:
1. Archive from detail actions menu.
2. Optionally include related child records when prompted.
3. Use `Archive` module to review and restore.

## Reports

Primary purpose:
- Provide operational reporting for hiring activity, throughput, and team accountability.

Common actions:
1. Open `Reports`.
2. Set a date range.
3. If your role allows it, filter by division and/or owner.
4. Review summary KPIs, current pipeline counts, daily trend, and owner performance.
5. Click owner performance chips to open owner-scoped detail in the same drill-through modal used by the other report cards.
6. Use `Export Excel` to download the current report as a multi-sheet workbook with a `Summary` tab and one tab per entity (`Candidates`, `Job Orders`, `Submissions`, `Interviews`, `Placements`). Each entity tab mirrors the detail shown in the report modal and is sorted by status, then alphabetically.
7. Click cards or pipeline counts to drill into the matching records in a modal.

Behavior notes:
- Administrators can report across all divisions.
- Directors can report on users and records in their division.
- Recruiters are locked to their own data only in reporting.
- Archived records are excluded.

## 6) Dashboard

Dashboard is designed for action, not reporting noise.

Expect to see:
- Key metric cards for:
	- Interviews Today
	- Awaiting Feedback
	- Web Responses
	- Interview Requests
	- Open Jobs Stalled 7d
	- Placements This Month
- A compact 7-day activity strip for candidates, job orders, submissions, interviews, and placements
- Needs Attention items requiring follow-up, including smart workflow alerts like untouched web responses, unscheduled client interview requests, and stale client portal activity.
- Upcoming interview schedule.
- Recently added candidates.
- Recently opened job orders.
- Fixed-height dashboard sections with paging when a section has too many rows.

Data shown is scoped to your permissions and division access rules.

## 7) Career Site Flow

If enabled by admin:
- Public users can browse open jobs and view details.
- Public applications create:
- Candidate (source: `Career Site`)
- Submission linked to the job order
- Uploaded resume file attachment

Owner notifications:
- Job owner can receive quick-apply emails if notification settings allow.

Account notification settings:
- `Account Settings` lets each user control whether they receive:
- Career site application emails
- Client feedback notifications from the client review portal, including email alerts when enabled
- The client feedback notification toggle is hidden when the client portal is disabled globally

## 8) Audit Trail And Accountability

- Updates are logged with actor, timestamp, and field-level changes.
- Audit panel is opened from actions menu on detail pages by administrators only.
- Payload view is available for administrator review.

## 9) Common Troubleshooting

`Save disabled`:
- Check required fields, email/URL format, and locked-field restrictions.

`No typeahead results`:
- Confirm records exist in your access scope (division + owner rules).
- For submission candidate selection, only qualified/open candidates may appear.

`Invite or notification did not send`:
- Verify SMTP settings in admin.
- Verify user notification preference.
- Check whether test mode rerouted email.

`Cannot edit record`:
- Record may be locked by status (`Accepted`, converted submission, etc.).
- You may not have ownership/division permission.

## 10) First-Day Checklist For New Users

1. Confirm your profile and password.
2. Verify your division and owner assignment.
3. Create one client, one contact, one job order.
4. Add one candidate and create one submission.
5. Schedule one interview and test `.ics` download.
6. Convert one submission to placement to understand the full lifecycle.
