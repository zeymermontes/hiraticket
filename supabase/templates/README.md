# Supabase Auth email templates (Hiraticket)

Branded HTML for every Supabase Auth email. All use table-based, inline-styled
markup so they render across Gmail, Apple Mail, Outlook, etc.

| File | Supabase template | Variable(s) used |
|------|-------------------|------------------|
| `confirmation.html`      | Confirm signup        | `{{ .ConfirmationURL }}` |
| `invite.html`            | Invite user           | `{{ .ConfirmationURL }}` |
| `magic_link.html`        | Magic Link            | `{{ .ConfirmationURL }}` |
| `recovery.html`          | Reset Password        | `{{ .ConfirmationURL }}` |
| `email_change.html`      | Change Email Address  | `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` |
| `reauthentication.html`  | Reauthentication      | `{{ .Token }}` (6-digit code) |

## Suggested subjects

- Confirm signup — `Confirma tu correo · Hiraticket`
- Invite user — `Te invitaron a Hiraticket`
- Magic Link — `Tu enlace de acceso · Hiraticket`
- Reset Password — `Restablece tu contraseña · Hiraticket`
- Change Email — `Confirma tu nuevo correo · Hiraticket`
- Reauthentication — `Tu código de verificación · Hiraticket`

## How to apply

**Option A — Dashboard (hosted project):**
Authentication → Emails → Templates. Pick each template, paste the matching file's
HTML into the "Message body" box, set the subject above, save.

**Option B — Local / CLI (`supabase/config.toml`):**

```toml
[auth.email.template.confirmation]
subject = "Confirma tu correo · Hiraticket"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.invite]
subject = "Te invitaron a Hiraticket"
content_path = "./supabase/templates/invite.html"

[auth.email.template.magic_link]
subject = "Tu enlace de acceso · Hiraticket"
content_path = "./supabase/templates/magic_link.html"

[auth.email.template.recovery]
subject = "Restablece tu contraseña · Hiraticket"
content_path = "./supabase/templates/recovery.html"

[auth.email.template.email_change]
subject = "Confirma tu nuevo correo · Hiraticket"
content_path = "./supabase/templates/email_change.html"

[auth.email.template.reauthentication]
subject = "Tu código de verificación · Hiraticket"
content_path = "./supabase/templates/reauthentication.html"
```

## Notes

- Brand: `#F5C518` (gold) with `#1A1606` text on it — matches the app's `--brand`.
- The default SMTP has a low rate limit; for production configure a custom SMTP
  (Resend/SES/Postmark) under Authentication → Emails → SMTP Settings.
- These are localized to Spanish to match the app's default language.
