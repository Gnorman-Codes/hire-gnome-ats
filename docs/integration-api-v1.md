# Hire Gnome Integration API v1

The API lives at `https://your-hire-gnome.example/api/v1` on your installation.
Use a dedicated credential for each integration. The browser API and the
Closer Gnome connection have separate authentication.

## Issue and rotate a credential

In Hire Gnome, open **Admin Area → API Keys**. Name the key, select the director
or recruiter account it should use, then choose **Read Only** or **Read and Write**.
Select **Create Key** and copy the API key and base URL into your integration.
Store the key in your integration’s secret store. Hire Gnome shows it once.

To rotate a key, create a replacement, update your integration, then select
**Revoke Key** beside the old key. On the public demo, the shared admin can
create and revoke keys for the demo recruiter. Keys are cleared when that
recruiter is recreated during a scheduled demo reset.

Server operators can also manage keys from the command line. On Docker, run
these commands inside the ATS container.

```sh
node scripts/manage-api-credentials.cjs create USR-RECORD-ID "Sourcing integration" read-write
node scripts/manage-api-credentials.cjs list
node scripts/manage-api-credentials.cjs revoke KEY-RECORD-ID
```

Use an active director or recruiter assigned to a division. Their account must
have completed any required password change. Each request includes
`Authorization: Bearer $HIRE_GNOME_API_TOKEN`. Use HTTPS outside localhost.

Credentials are bound to the user's role and division at creation. A director
can work across that division and assign records to its active users. A
recruiter can assign records only to themselves and has owner-only visibility
in owner-only divisions. The key stops working if the user is deactivated, moves
division, changes role, or must change a temporary password. The audit trail
records the credential and its bound user on each write.

## Endpoints

| Resource | List | Read | Create | Update |
| --- | --- | --- | --- | --- |
| Clients | GET /clients | GET /clients/{recordId} | POST /clients | PATCH /clients/{recordId} |
| Contacts | GET /contacts | GET /contacts/{recordId} | POST /contacts | PATCH /contacts/{recordId} |
| Candidates | GET /candidates | GET /candidates/{recordId} | POST /candidates | PATCH /candidates/{recordId} |
| Job orders | GET /job-orders | GET /job-orders/{recordId} | POST /job-orders | PATCH /job-orders/{recordId} |
| Submissions | GET /submissions | GET /submissions/{recordId} | POST /submissions | PATCH /submissions/{recordId} |

- `GET /owners` lists the active users you can assign, with their record IDs.
- `POST /candidates/upsert` matches a normalized email within scope. It
  returns 201 on create and 200 on update. On create it requires the same fields
  as POST /candidates. A record with the same email outside scope or in the
  archive results in a generic 409. Store each returned candidate record ID.
- List requests accept `limit` (1–100, default 50), `cursor`, and `updatedSince`
  (inclusive ISO date and time with offset). The candidate list also accepts
  `email`. Keep filters constant across pages and pass back the opaque
  `page.nextCursor` until it is null. Lists are ordered by creation ID and do
  not take a point-in-time snapshot.
- Connect records using `recordId` values, including for jobs with identical
  titles. Owner defaults to the credential user at creation. Contacts inherit
  the client relationship supplied in the request. Jobs require a client and a
  hiring contact from that client.
- PATCH preserves omitted fields. Use null to clear supported nullable fields.
  Use `stageChangeReason` when changing a candidate's overall status.
- A submission is unique to its candidate and job. Repeating POST for the same
  pair returns the existing submission with 200 and preserves its current
  status and notes. Use PATCH to change status, notes, or custom fields.
  Candidate, job, and submitting user are set on creation. API-created
  submissions start hidden from the client portal. A submission converted to
  placement is locked. Creating a submission requires an eligible candidate
  (In Review or beyond) and matching candidate and job divisions.
- Custom field keys match configured fields on the installation. Required
  custom fields apply on creation and when explicitly changing custom fields.
- Read and write limits are 600 and 120 requests per minute per credential.
  Respect `Retry-After` on 429. Error responses include `error.code` and
  `error.message`; validation errors can also include `error.fields`.
  Scoped or archived records are returned as unavailable.

## Candidate and submission example

Import the [Postman collection](integration-api-v1.postman_collection.json)
for a working example with list, detail, and retry checks. Set `baseUrl` to your
installation’s `/api/v1` address and `apiKey` to your key in an active Postman
environment. Run only **List Records** to try read-only access.

Create or update a candidate, then use the returned record ID for the submission.
Use the owner's record ID from `GET /owners` when assigning a different recruiter.
Use a job record ID from `GET /job-orders`.

```sh
curl -sS "$HIRE_GNOME_URL/api/v1/candidates/upsert" \
  -H "Authorization: Bearer $HIRE_GNOME_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"email":"jamie@example.test","firstName":"Jamie","lastName":"Test","mobile":"2125550108","source":"Referral","currentJobTitle":"Engineer","currentEmployer":"Example Inc","status":"in_review"}'

curl -sS "$HIRE_GNOME_URL/api/v1/submissions" \
  -H "Authorization: Bearer $HIRE_GNOME_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"candidateRecordId":"CAN-RECORD-ID","jobOrderRecordId":"JOB-RECORD-ID","status":"submitted","notes":"Interested in the role."}'

curl -sS -X PATCH "$HIRE_GNOME_URL/api/v1/submissions/SUB-RECORD-ID" \
  -H "Authorization: Bearer $HIRE_GNOME_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"under_review","notes":"Hiring manager is reviewing."}'
```

A successful detail or write response has a `data` record. A successful list
response has a `data` array and `page.nextCursor`. See the
[OpenAPI contract](integration-api-v1.openapi.yaml) for request and response schemas.
Treat documented v1 fields and behavior as the upgrade contract. Clients should
tolerate additive fields and error codes. Breaking changes require a new major
API version. This version covers the resources above. Interviews, placements,
notes and activities endpoints, webhooks, and mailbox sync are separate work.

## Run the integration test locally

Apply the migrations to a disposable local MySQL database named
`hg_api_qa_<suffix>`. Start a local Hire Gnome instance using that database,
then set `HIRE_GNOME_API_TEST_DATABASE_URL` to its database URL and
`HIRE_GNOME_API_TEST_URL` to its HTTP address. Run
`node --test tests/integration-api-v1.test.cjs` from the repository root. The test
creates fixture records and credentials in that database.
