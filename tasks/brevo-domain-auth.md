# Authenticate `landavoice.com` in Brevo (stop login mail landing in spam)

**Goal:** make Brevo a *trusted* sender for `landavoice.com` so Supabase magic-link emails
land in the inbox, not spam. Spam happens today because the domain has **no DKIM, no DMARC,
and an SPF record that only lists Google** — so mail Brevo sends fails authentication.

**Who does what:** I prepared this and will verify propagation. **You execute it** — the DKIM
key and the `brevo-code` value are unique to your Brevo account, and the DNS lives at **IONOS**
(I have no access to either).

---

## Current DNS state (verified 2026-05-24)

| Record | Host | Present? | Value today |
|---|---|---|---|
| SPF (TXT) | `@` | ⚠️ Google-only | `v=spf1 include:_spf.google.com ~all` |
| DKIM (TXT) | `mail._domainkey` | ❌ missing | — |
| DMARC (TXT) | `_dmarc` | ❌ missing | — |
| `brevo-code` (TXT) | `@` | ❌ missing | — |

DNS is hosted at **IONOS** (nameservers `ns*.ui-dns.*`). Mailbox `nick@landavoice.com` is on
Google Workspace — **keep the Google SPF include**; we *merge* Brevo into it, never replace it.

---

## Step 1 — Get your two account-specific values from Brevo

1. Brevo → **Settings ▸ Senders, Domains & Dedicated IPs ▸ Domains**.
2. Find `landavoice.com` (it's already a sender domain) → **Authenticate this domain**.
3. Brevo shows the records to add. **Copy these two exactly** (they're unique to you):
   - **`brevo-code`** — a TXT value like `brevo-code:abc123…`.
   - **DKIM** — a TXT record. Brevo's selector is normally **`mail._domainkey`**, value
     `k=rsa; p=<long base64 key>`. **Use the exact host + value Brevo shows you** — don't
     hand-type the key.

> Leave the Brevo tab open on this screen; you'll click **Verify / Authenticate** at the end.

## Step 2 — Add / edit four records in IONOS

IONOS → **Domains & SSL ▸ `landavoice.com` ▸ DNS**. IONOS quirks: enter the **host without**
`.landavoice.com` (IONOS appends it); leave the host **blank or `@`** for the root; paste TXT
values **without** surrounding quotes.

| # | Type | Host (IONOS) | Value | Action |
|---|---|---|---|---|
| 1 | TXT | `@` | `brevo-code:…` *(from Brevo)* | **Add** |
| 2 | TXT | `mail._domainkey` *(or exactly what Brevo shows)* | `k=rsa; p=…` *(from Brevo)* | **Add** |
| 3 | TXT | `@` | `v=spf1 include:_spf.google.com include:spf.brevo.com ~all` | **EDIT the existing SPF** |
| 4 | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:nick@landavoice.com; fo=1` | **Add** |

**Record 3 is an edit, not an add** — a domain may have only **one** SPF record; two breaks SPF.
Open the existing `v=spf1 include:_spf.google.com ~all` and insert `include:spf.brevo.com` before
`~all`. (Leave the `google-site-verification=…` TXT untouched — it's unrelated.)

**Record 4 DMARC** starts at `p=none` — that's **monitor-only**, it can't cause rejection. Once
SPF+DKIM are confirmed passing for a week or two, we can tighten to `p=quarantine`.

> Brevo may also offer an optional click/open-tracking CNAME (e.g. a `mail` subdomain). It's **not
> needed** to fix spam — skip it unless you want link tracking.

## Step 3 — Verify in Brevo, then I confirm

1. Wait for propagation (IONOS is usually <1 h, can be up to 24 h).
2. Back in Brevo → click **Verify / Authenticate**. DKIM + Brevo code should go green.
3. Tell me, and I'll confirm independently:
   ```bash
   dig +short TXT landavoice.com                       # SPF now has spf.brevo.com
   dig +short TXT mail._domainkey.landavoice.com        # DKIM key present
   dig +short TXT _dmarc.landavoice.com                 # DMARC present
   ```
4. Final proof: send yourself a magic link from the app → it lands in the **inbox**, and the
   message header shows `DKIM=pass`, `SPF=pass`, `DMARC=pass`.

---

## Notes
- Sender in Supabase is `nick@landavoice.com` (name "Landa"), SMTP `smtp-relay.brevo.com:587` —
  already wired; this task only fixes *authentication*, no Supabase change needed.
- Keep `p=none` until SPF/DKIM are confirmed; tightening too early can silently drop real mail.
