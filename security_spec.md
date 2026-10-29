# Security Specification — SiagaWarga RW 013

## 1. Data Invariants & Master Source of Truth

1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false;`).
2. **Verified Identity Invariant**: Every write and read requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`).
3. **PII Split-Collection Isolation**:
   - `/users/{userId}` stores only public/non-PII citizen metadata (`uid`, `displayName`, `rt`, `createdAt`, `updatedAt`).
   - `/users/{userId}/private/{docId}` stores sensitive PII (`email`, `phone`) behind a Master Gate (`get()` on parent `/users/{userId}`) and is strictly readable/writable only by `isOwner(userId)` or `isAdmin()`.
4. **Relational Integrity (No Orphaned Records)**:
   - Creating a `/reports/{reportId}` or `/jumantikLogs/{logId}` requires an existing `/users/{authorId}` profile matching `request.auth.uid`.
   - Creating a `/notifications/{notificationId}` requires `isAdmin()`, `senderId == request.auth.uid`, an existing `/users/{recipientId}`, and an existing `/reports/{reportId}`.
   - Creating an `/agencyDispatches/{dispatchId}` requires `isAdmin()`, `authorId == request.auth.uid`, and an existing `/reports/{reportId}`.
5. **Domain Math Invariant (ABJ RW 013)**:
   - On `/jumantikLogs/{logId}`, `housesInspected >= 1 && housesInspected <= 500` and `housesWithLarvae >= 0 && housesWithLarvae <= housesInspected`.
6. **Terminal State Locking**:
   - Once a `CitizenReport` reaches `status == 'selesai'` or `status == 'ditolak'`, non-admin users are completely locked from modifying it. Citizens can only edit `title`, `description`, or `urgency` while `status == 'menunggu'`. Only `isAdmin()` can transition triage states or override terminal states.
   - Once a `PushNotification` reaches `read == true`, recipients cannot revert or re-update it.
7. **Secure List Queries (Zero Client Delegation & Zero O(n) Lookups)**:
   - `/users`, `/users/{userId}/private`, and `/admins` forbid `list` (`allow list: if false;`).
   - `/reports` `list` enforces `resource.data.authorId == request.auth.uid || (resource.data.rwCode == 'RW013' && resource.data.visibility == 'public') || isBootstrappedAdmin()`.
   - `/jumantikLogs` and `/agencyDispatches` `list` enforce `resource.data.rwCode == 'RW013' || isBootstrappedAdmin()`.
   - `/notifications` `list` enforces `resource.data.recipientId == request.auth.uid || isBootstrappedAdmin()`.
   - Zero `get()` or `exists()` calls appear inside any `allow list` rule.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Identity Spoofing on Citizen Report**: Authenticated user `uid_attacker` submits a `CitizenReport` with `authorId: "uid_victim"`. -> `PERMISSION_DENIED`
2. **Payload 2 — Shadow / Ghost Field Injection**: Authenticated user creates a valid `CitizenReport` plus `"isVerified": true`. -> `PERMISSION_DENIED` (`hasOnly` rejects unknown key)
3. **Payload 3 — Unverified Admin Email Spoof**: Attacker signs in with `email: "ikhwanster@gmail.com"` and `email_verified: false` to update report `status: "selesai"`. -> `PERMISSION_DENIED`
4. **Payload 4 — PII Blanket Read**: Authenticated non-owner `uid_other` calls `get` on `/users/uid_victim/private/info`. -> `PERMISSION_DENIED`
5. **Payload 5 — Self-Assigned Admin Escalation**: Regular user writes `/admins/uid_attacker` with `role: "admin"`. -> `PERMISSION_DENIED`
6. **Payload 6 — Citizen Status Shortcutting**: Report author attempts to update their own report `status` from `"menunggu"` to `"selesai"`. -> `PERMISSION_DENIED` (`affectedKeys().hasOnly` blocks `status`)
7. **Payload 7 — Terminal State Mutation**: Report author attempts to edit `description` on a report already in `status: "selesai"`. -> `PERMISSION_DENIED`
8. **Payload 8 — ID Poisoning (2KB Document ID)**: Attacker attempts to create a report with a 2000-character document ID or invalid regex characters. -> `PERMISSION_DENIED`
9. **Payload 9 — Denial-of-Wallet Oversized Description**: User submits a `CitizenReport` with a 50,000-character `description` (exceeding `maxLength: 1500`). -> `PERMISSION_DENIED`
10. **Payload 10 — Temporal Forgery**: User submits a `CitizenReport` with a backdated client timestamp (`2020-01-01T00:00:00Z`) instead of `request.time`. -> `PERMISSION_DENIED`
11. **Payload 11 — Impossible Jumantik Math**: User submits a `JumantikLog` where `housesInspected: 10` and `housesWithLarvae: 25`. -> `PERMISSION_DENIED`
12. **Payload 12 — Unauthorized Notification Scrape (`list`)**: User `uid_attacker` executes an unfiltered `getDocs(collection(db, 'notifications'))` attempting to read all citizens' push notifications. -> `PERMISSION_DENIED`
