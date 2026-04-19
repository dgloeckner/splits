# FEAT-0002: User Profiles & Onboarding

- **Status**: Draft
- **Depends on**: ADR-0005 (per-rower QR pairing), ADR-0006 (TLS)

## Summary

Multiple household members share the single installation. Each rower has
a profile (name plus optional weight / DOB) and onboards onto a device by
**scanning a personal QR code** handed out by the admin. A scanned device
remembers that rower across sessions — no password prompts, no profile
picker needed on personal devices.

The auth mechanism is defined in ADR-0005: the QR encodes a long-lived
pairing token that a device exchanges for a session cookie; tokens are
per rower and independently revocable.

## User stories

- As a new rower, I want to scan **one QR code** and have the app remember
  me — no password, no account signup — so I can start rowing within
  seconds of being handed the code.
- As a rower, I want the live view to know it's me without picking a
  profile every session.
- As the household admin, I want to add a new rower from the admin screen
  and hand them (or AirDrop / text / print) their QR.
- As the household admin, I want to **revoke** a rower's QR if a device
  is lost or a member leaves, without disturbing the others.
- As a rower sharing a tablet at the ergo, I want to tap my avatar to
  become the "active" rower, from the list of rowers already paired on
  that device.
- As the admin, I want the first-run setup to show me **my own QR** so I
  can scan from my phone and bootstrap the household.

## Acceptance criteria

### Pairing

- [ ] Unpaired device shows a single "Scan your QR code" call-to-action
      and nothing else (no login form, no empty profile list).
- [ ] Scanning a valid QR completes onboarding in one step: the device
      remembers the rower, the live view loads, nothing else is asked.
- [ ] The pairing URL uses an HTTPS fragment (`#t=…`) so the token is
      never sent in an HTTP request line; the PWA reads it client-side
      and exchanges it for an `HttpOnly` session cookie.
- [ ] Scanning an **already-used** QR on the same device is idempotent
      (no-ops cleanly).
- [ ] Scanning a valid QR on a device that already has paired rowers
      adds the new rower to that device's list; it does not remove
      existing pairings.
- [ ] Scanning a **revoked** QR shows a clear "This code is no longer
      valid — ask the admin for a new one" message.

### Profile

- [ ] Creating a rower requires only a name. Optional fields: weight,
      date of birth, display colour / avatar initial.
- [ ] A rower can edit their own profile fields from the app.
- [ ] Rower deletion is soft: past sessions are retained and remain
      attributed; a deleted rower is hidden from pickers and their
      pairing token is invalidated. Recoverable for 30 days.

### Multi-rower devices

- [ ] A single device can hold ≥ 4 paired rowers (practical family
      size) without UX degradation.
- [ ] The "active" rower switcher is one tap from the live view —
      horizontal avatar strip.
- [ ] The device remembers the last-active rower across reloads.

### Admin

- [ ] First run on the deploy host surfaces the **initial admin QR**
      (printed to stdout by the setup command AND shown in a one-shot
      setup wizard URL).
- [ ] An admin-only "Household" screen lists rowers, with actions:
      generate QR image (downloadable SVG/PNG), rotate token
      (invalidates all session cookies for that rower), delete.
- [ ] Admin rights are a rower-level flag (`is_admin`), set during
      creation; non-admins do not see the Household screen.
- [ ] Admin cannot delete themselves if they are the only admin.

### Privacy & storage

- [ ] No PII leaves the device or backend.
- [ ] No external auth provider. No email, phone, OAuth.
- [ ] Pairing tokens are stored on the backend as salted hashes
      (Argon2id), never in plaintext.

## UX notes

- **First-ever experience** (admin): run `ergo-setup` (or open the
  `/setup` URL on the host) → receive the admin QR → scan from phone →
  PWA opens already paired as "Admin". The setup flow disables itself
  after first successful admin pairing.
- **Everyone else**: admin opens Household → "Add rower" → enters the
  name → hands the rower the resulting QR (on-screen, print, or share).
  Rower scans → they're in.
- **Live view**: top strip shows the active rower's avatar; tap to
  reveal the other rowers paired on this device; tap one to switch. A
  "+" at the end opens the QR scanner to add another rower. No
  passwords, no sign-out button — "sign-out" on a device = admin
  rotates that rower's token.
- **QR generation**: backend renders an SVG so it scales to any print
  size; PWA also shows it full-screen for camera capture from another
  device.

## Non-goals

- Per-user *passwords* (tokens are the secret; QR is the delivery).
- Email / phone / OAuth / magic links.
- Roles & permissions beyond admin vs non-admin.
- Cross-household federation or cloud profile sync.
- Guest mode as a separate feature — admin can just create a throwaway
  rower and delete it later.
- Anti-sharing enforcement. Two household members using the same QR is
  considered a user choice, not a threat (see ADR-0005).

## Open questions

- **QR content format**: URL with fragment is the plan (ADR-0005); any
  need for a JSON-encoded payload for richer metadata (rower name,
  avatar colour) so the PWA can show who they're becoming *before*
  hitting the server? Probably yes — embed `name` + `token` together,
  with the server still validating the token. Decide during M3 build.
- **Multi-rower switcher affordance when > 6 rowers** on one device
  (improbable in a household, but guard against overflow in the UI).
- **Offline-first behavior**: if the PWA is loaded offline and the
  session cookie has expired, can the user still view cached history as
  their stored active rower? Acceptable since no mutations are possible
  offline; revisit with FEAT-0006.
- **QR rotation cadence**: tokens don't expire on their own by default
  (ADR-0005). Offer a "rotate all" household-wide admin button for the
  paranoid case? Low priority.
