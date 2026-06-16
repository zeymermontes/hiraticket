# Send Supabase Auth emails via Resend (hiraticket.com)

Point Supabase Auth's SMTP at Resend so every auth email (signup confirm, invite,
magic link, password reset, email change, reauthentication — using the templates in
`supabase/templates/`) is delivered from your verified `hiraticket.com` domain.

## 1. Verify the domain in Resend (you said it's created)

Resend → Domains → `hiraticket.com` must show **Verified** (the SPF/DKIM/DMARC DNS
records are in place). If not, add the records Resend lists to your DNS and wait for
verification before continuing — unverified domains can't send.

## 2. Create a Resend API key

Resend → API Keys → Create. Give it **Sending access**. Copy the key (`re_...`).
This key is the SMTP **password**.

## 3. Pick a sender address (on the verified domain)

Auth emails should come from a no-reply mailbox on the domain, e.g.
`no-reply@hiraticket.com`. (You don't need a real inbox for it to send.)

## 4. Configure custom SMTP in Supabase

**Dashboard (hosted project):** Authentication → Emails → **SMTP Settings** →
Enable custom SMTP, then:

| Field | Value |
|-------|-------|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (`re_...`) |
| Sender email | `no-reply@hiraticket.com` |
| Sender name | `Hiraticket` |

Save. Then under Authentication → Emails → **Templates**, paste each template from
`supabase/templates/` (see that folder's README) and set the subjects.

**Local / CLI (`supabase/config.toml`):**

```toml
[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_SMTP_PASSWORD)"
admin_email = "no-reply@hiraticket.com"
sender_name = "Hiraticket"
```

Set `RESEND_SMTP_PASSWORD` to the Resend API key in your shell/`.env` (see
`.env.example`). Never commit the real key.

## 5. Raise the auth rate limit (optional)

Supabase's built-in SMTP caps at a few emails/hour. With Resend you can lift it:
Authentication → Rate Limits → "Emails sent per hour".

## 6. Test

Trigger a flow (sign up a test user / invite an agent from the Agents page / request
a password reset). Confirm the email arrives, the `From` is `no-reply@hiraticket.com`,
and it isn't flagged as spam. Watch deliveries in Resend → Logs.

## Notes

- The app already sends invites via Supabase Auth (`inviteUserByEmail` in
  `src/app/(app)/agents/actions.ts`), so they'll flow through Resend automatically
  once SMTP is set — no app code change needed.
- If you later want product emails (receipts, digests) sent directly from the app,
  use the Resend API (`@resend/node`) with `RESEND_API_KEY` server-side — ask and I'll
  wire it.
