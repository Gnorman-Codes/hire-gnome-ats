# Submissions

## What This Module Is For
Submissions tracks candidate presentation to a specific job order.

The submissions list also supports a separate `Advanced Search` builder so recruiters can combine structured filters like status, origin, submitter, client-portal visibility, and submitted/updated date ranges without overloading the basic search box.

## Core Relationships
Each submission is linked to:
- One candidate
- One job order
- One client (via job order)
- One hiring manager (via job order/contact)

## Edit Constraints
After creation:
- Candidate and job order are locked
- Converted submissions become non-editable

## Common Lifecycle
1. Create submission.
2. Add recruiter notes/context.
3. Generate or edit a client-facing write-up.
4. Advance status through review/interview steps.
5. Convert to placement when accepted.

## Actions Menu
Key actions:
- Schedule interview
- Promote to / hide from client portal
- Open submission packet
- Convert to placement (with confirmation)
- View audit trail (administrators only)
- Archive

## Submission Packet
Submission detail includes a `Submission Packet` action for a print-friendly internal packet.

Behavior:
- Opens in a dedicated packet view from the submission actions menu
- Designed for browser print / Save as PDF
- Compiles:
	- recruiter write-up
	- primary resume download link
	- candidate snapshot
	- cached match explanation
	- recent interview activity and latest AI question set when available

## Client Write-Up
Submission detail includes a dedicated `Client Write-Up` field for polished recruiter/client-facing candidate summaries.

Behavior:
- Generate or refresh from the toolbar above the field
- Copy directly to the clipboard from the toolbar
- Output is stored on the submission record
- Recruiters can edit the generated text before saving
- Uses the OpenAI API key from `Admin Area > System Settings`
- If the submission is converted to a placement, the write-up remains visible but is locked
- If OpenAI is not configured, the generate control remains visible but disabled with an inline hint

## Send a Submission by Email

On the submission, choose **Actions → Send Submission by Email**. Hire Gnome
uses the hiring manager assigned to the job order. Review the recipient and
reply address, edit the subject or message, then choose **Send Email**.
Replies go to the sending recruiter's account email.

Outgoing email uses the SMTP settings in **Admin Area → System Settings**.
When email test mode is on, Hire Gnome routes the message to the configured
test recipient. The submission timeline records the message and delivery status.
In demo mode, submission emails use a separate local capture directory set by
`DEMO_SUBMISSION_MAIL_DIR`. The application user needs write access to this
directory. Demo submission email has no SMTP fallback.

Choose **Actions → Log Client Feedback** to record a reply or feedback received
by phone. The entry appears in the timeline without changing the submission status.

## Client Feedback
Submission detail includes a `Client Feedback` section for portal-driven client responses.

Behavior:
- Submission detail shows both submission `Origin` and `Client Portal` visibility so recruiters can differentiate career-site responses from recruiter-curated submissions.
- Career-site `Web` responses start hidden from the client portal until a recruiter explicitly promotes them.
- Recruiters can later hide a submission from the client portal again from the same actions menu.
- The client feedback tab and portal visibility controls are hidden when the portal is disabled. Recruiters can still log feedback in the timeline.
- Shows comments, scorecard ratings, and action history submitted through the client review portal
- Includes the client name/email snapshot and timestamp for each entry
- Captures actions like `Request Interview`, `Feedback`, and `Pass`
- `Pass` is confirmed in the portal and locks the submission against any further client actions
- When a client uses `Pass`, the submission is also moved to the bottom of the job order's priority order
- The portal only exposes the candidate's labeled primary resume; other candidate attachments stay internal
- Feedback submitted through the portal is read-only internally.

## Workspace Timeline And Feedback
The submission timeline shows status changes, interviews, outgoing email, client feedback, write-up generation, and placement conversion in chronological order.

## Snapshot Usage
Snapshot emphasizes immutable context and links back to source records.

## Best Practice
- Always add concise submission notes so downstream users understand positioning.
- Keep status current to improve dashboard priority logic.

## Advanced Search
Use advanced search on the submissions list when quick lookup is not enough.

Useful examples:
- `Status = Submitted`
- `Origin = Web`
- `Client Portal = Hidden`
- `Submitted By = Alicia Morgan`
- `Submitted At in past 14 days`
