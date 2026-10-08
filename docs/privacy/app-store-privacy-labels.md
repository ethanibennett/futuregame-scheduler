# App Store Connect: App Privacy answers (DRAFT)

DRAFT for owner review, 2026-10-08. Each answer cites `docs/privacy/data-inventory.md`
(cited as "Inv §n"), which in turn cites the code.

**Apple's definition, which drives every "No" below.** Data is *collected* when it leaves the
device in a way that lets you or a partner access it for longer than it takes to serve the
request in real time. Data processed only on the device is not collected.

**Assumption.** These answers assume public-release gating stays as it is today:

- Staking is admin-only.
- The Hands tab is admin or invite only.
- Push registration is admin-only.
- Quick-add is admin-only.
- There are no in-app purchases.

Each gated item has a row saying what flips if the gate opens.

## Step 1: "Do you or your third-party partners collect data from this app?"

**Yes.**

## Step 2: Tracking

**"Do you or your third-party partners use data for tracking purposes?" No.**
No advertising SDK, no IDFA, no App Tracking Transparency prompt, no data brokers, and no data
combined with other companies' data for ads or ad measurement (Inv §12, "Not present"). Do **not**
add `NSUserTrackingUsageDescription`.

## Step 3: Data types

Purposes used below: **App Functionality** (AF). No type is used for Third-Party Advertising,
Developer's Advertising or Marketing, Analytics, or Product Personalization. Location radius
filtering is a filter the user sets, not personalization.

### Contact Info

| Type | Collected | Linked to user | Tracking | Purposes | Justification |
|---|---|---|---|---|---|
| Name | **Yes** | Yes | No | AF | Full name required at registration and shown to other members (Inv §1, §6). |
| Email Address | **Yes** | Yes | No | AF | Login and password reset (Inv §1). |
| Phone Number | No | — | — | — | Users never give a phone number. Backer phones exist only in the admin-only staking feature and the operator's own program (Inv §7, §8). **Flips to Yes** if staking ships. |
| Physical Address | No | — | — | — | Not requested anywhere. |
| Other User Contact Info | No | — | — | — | — |

### Health & Fitness
Health: **No**. Fitness: **No**.

### Financial Info

| Type | Collected | Linked | Tracking | Purposes | Justification |
|---|---|---|---|---|---|
| Payment Info | No | — | — | — | No payment code. Apple/Stripe webhooks are stubs (Inv §10). |
| Credit Info | No | — | — | — | — |
| Other Financial Info | **Yes** | Yes | No | AF | Tournament buy-ins, cashes, amounts won and deal payouts in results and live updates (Inv §4). Apple's examples include income and assets. [CHECK: judgement call. Declaring is the conservative answer.] |

### Location

| Type | Collected | Linked | Tracking | Purposes | Justification |
|---|---|---|---|---|---|
| Precise Location | **Yes** | Yes | No | AF | "Current Location" coordinates are saved unrounded to `users.saved_location` for signed-in users (Inv §2). [CHECK: if the coordinates are rounded to about 1 km before saving, change this row to **No** and keep only Coarse.] |
| Coarse Location | **Yes** | Yes | No | AF | Typed place search saves a city-level point and the state (`jurisdiction`) to the account (Inv §2). |

### Sensitive Info
**No.** Nothing in Apple's list (racial or ethnic origin, sexual orientation, pregnancy,
disability, religious or philosophical beliefs, union membership, political opinion, genetic or
biometric data) is collected.

### Contacts
**No.** The app never reads the address book. Buddies and groups are connections made inside the
app (Inv §5). [CHECK: Apple's description mentions a "social graph". Most apps with in-app
friends answer No, but confirm you agree.]

### User Content

| Type | Collected | Linked | Tracking | Purposes | Justification |
|---|---|---|---|---|---|
| Emails or Text Messages | **Yes** | Yes | No | AF | Group chat messages are stored with the sender (Inv §5). |
| Photos or Videos | **Yes** | Yes | No | AF | Profile photo is stored. Table Scanner images go to Anthropic, which keeps API inputs beyond the real-time request (Inv §3, §12). Camera overlays stay on device and do not count. |
| Audio Data | No | — | — | — | No microphone or speech use (Inv §3). |
| Gameplay Content | No | — | — | — | Trainer hands are admin-only (Inv §4). **Flips to Yes** if the trainer opens. [CHECK] |
| Customer Support | No | — | — | — | No in-app support channel. |
| Other User Content | **Yes** | Yes | No | AF | Schedules, conditional plans, personal-event notes, result notes, live updates (Inv §4). Saved hands and shared hand links for accounts with replayer access. |

### Browsing History
**No.**

### Search History
**No.** Place searches and member searches are answered in real time and not stored by us. The
server forwards place queries to Nominatim with no identifier (Inv §2, §6). [CHECK: OSMF keeps its
own request logs, and some reviewers count that. If you want the conservative answer: Yes,
Not linked, AF.]

### Identifiers

| Type | Collected | Linked | Tracking | Purposes | Justification |
|---|---|---|---|---|---|
| User ID | **Yes** | Yes | No | AF | Account id and username (Inv §1). |
| Device ID | No | — | — | — | No IDFA or IDFV. The APNs device token is registered only by admin accounts today (Inv §9). [CHECK: if notifications open to all users, decide whether to declare the push token as Device ID. Apple does not require it, but some developers do.] |

### Purchases
Purchase History: **No.** The only subscription rows are the free trial and manual admin grants;
there are no transactions (Inv §10). **Flips to Yes** (Linked, AF) when IAP or Stripe ships.

### Usage Data
Product Interaction: **No**. Advertising Data: **No**. Other Usage Data: **No**.
There are no analytics. The server keeps only functional state such as "last seen
notifications" timestamps (Inv §1).

### Diagnostics
Crash Data: **No**. Performance Data: **No**. Other Diagnostic Data: **No**.
There is no crash-reporting SDK. Server-side error logs are not data collected from the device
(Inv §12, §13).

### Surroundings / Body
Environment Scanning: **No**. Hands: **No**. Head: **No**.

### Other Data
**No.**

## Summary card (as it will appear on the App Store)

**Data Linked to You** (all App Functionality):
Contact Info (Name, Email Address), Financial Info (Other Financial Info),
Location (Precise, Coarse), User Content (Emails or Text Messages, Photos or Videos, Other User
Content), Identifiers (User ID).

**Data Not Linked to You:** none.

**Data Used to Track You:** none.

## Other App Store Connect fields that depend on privacy

- **Privacy Policy URL** (required): publish `privacy-policy-draft.md` once its CHECK items are
  resolved. [CHECK: URL, for example https://futurega.me/privacy. No such route exists yet.]
- **Account deletion** (Guideline 5.1.1(v)): required because the app creates accounts.
  `DELETE /api/account` and its in-app entry point must ship first.
- **User Privacy Choices URL**: optional. Could point to the deletion instructions.
- **Third-party data review**: the Table Scanner sends other people's names, read from a
  photograph, to Anthropic. It is worth a sentence in the App Review notes.
- **Privacy manifest**: the app target has no `PrivacyInfo.xcprivacy`. Capacitor uses
  `UserDefaults`, a "required reason" API. [CHECK: confirm that the locally built Capacitor
  xcframeworks (`ios/App/capacitor-swift-pm/`) carry Capacitor's own privacy manifest. If they do
  not, add an app-level manifest declaring `NSPrivacyAccessedAPICategoryUserDefaults` (reason
  `CA92.1`) and `NSPrivacyTracking = false`.]
