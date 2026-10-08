# futurega.me Privacy Policy (DRAFT)

> **DRAFT for owner review. Not published and not linked from the app.**
> Every statement below comes from `docs/privacy/data-inventory.md`, which cites the code.
> Items marked **[CHECK: …]** need an answer from the owner before this goes live. Remove
> this box and all CHECK markers before publishing.

**Effective date:** [EFFECTIVE DATE]
**Who we are:** futurega.me (the website at futurega.me and the futurega.me app for iPhone, iPad
and Mac) is run by [OPERATOR NAME] [CHECK: Ethan Bennett as an individual, or a business
entity? Include a postal address if one is required where you operate.]
**Contact:** [CONTACT EMAIL]

This policy explains what information futurega.me collects, why, who else receives it, how long
we keep it, and how to delete it. We have tried to describe what the app actually does, in plain
terms.

## The short version

- We collect what you give us to run your account and plan your poker: your username, email,
  full name, optional profile photo, your schedule and results, and your location if you choose
  to share it.
- We do **not** use advertising, analytics or crash-reporting services, we do **not** track you
  across other apps or websites, and we do **not** sell your information.
- A few features send data to other companies so the feature can work. The main ones are the
  **Table Scanner**, which sends the photo you scan to Anthropic, and **location search**, which
  sends the place you type to OpenStreetMap. Details below.
- Some of what you enter is visible to other people by design: your username, name and photo can
  be found by other members, and your schedule can be seen by buddies, groups, or anyone you send
  a share link to.

## 1. Information you give us

**Account.** To register you give a username, email address, full name and password. Your
password is stored only as a one-way hash, never in readable form. You can add, change or remove
a profile photo (JPEG, PNG or WebP, up to 200 KB) and change your name in Settings.

**Guest mode.** You can browse without an account. A guest session lasts 4 hours, and we store
nothing about guests on our servers. Your location choice and display preferences stay on your
device.

**Your poker activity.** When you use the app we store:
- the tournaments you add to your schedule, including planned re-entries and conditional plans
  ("if I bust, play X");
- personal calendar items such as Travel Day or Day Off, and any notes you add to them;
- your results: entries, whether you cashed, finishing place, amount won, and notes;
- live updates you post during a tournament: chip stack, blinds, bubble, final-table, deal,
  bagged or busted status, and when you started playing;
- if your account has the hand replayer: hands you save, which can include other players' names,
  stacks and cards that you enter, custom game definitions, and short links you create to share a
  hand. [CHECK: the Hands tab is limited to accounts you approve today. Keep this paragraph if
  that will still be true at launch.]

**Buddies and groups.** We store your buddy requests and connections, the groups you create or
join, group invitations, and **group chat messages**.

**Field sizes.** If you correct the number of entrants in an event, that number is shared with
all users.

## 2. Location

Location is optional. Without it you can pick a region, or see all events.

- **Current Location.** If you tap *Current Location*, your device asks for permission and
  then gives the app your coordinates. We use them to show events within the distance you chose,
  and to work out which US state you are in so we can show which online poker sites are available
  to you. We ask for your location only when you tap; we never track it in the background.
- **Typed search.** If you search for a place, the text you type is sent to OpenStreetMap
  (see §5) to find it.
- **Saved location.** If you are signed in, your chosen location (coordinates, distance,
  label and state) is saved to your account so it follows you to your other devices. It is also
  kept on your device. Choosing *All Locations* clears it.
  [CHECK: coordinates are currently saved at full device precision. Consider rounding them to
  about 1 km before saving. That would match the 100-mile default better and would let the App
  Store label say "Coarse Location" instead of "Precise Location".]

## 3. Camera and photos

- **Camera overlays** (live-update graphics, the registration receipt and starting-stack photos):
  the photo is taken and decorated **on your device**. It is never uploaded to us. It leaves
  your device only if you share or save it through the system share sheet.
- **Table Scanner.** When you scan or upload a photo or screenshot of a tournament seating list,
  the image is sent to our server and passed to **Anthropic's Claude API**, which reads the
  player names, chip counts and seats. We do not keep the image. The names it reads are shown to
  you and are kept on your device so the list survives a reload. Our server logs also record them
  [CHECK: do you want to keep logging scanned names (`server.js:12872`)? Removing that log line
  would let this sentence say we keep nothing]. A seating list shows other people's names, so
  please scan only lists you are entitled to view.
  [CHECK: the Table Scanner is available to guests and every signed-in user. Confirm that's
  intended, since every scan is a paid API call that sends an image to a third party.]
- **Player lookups.** If you tap a scanned player's name, our server searches **DuckDuckGo**
  for that player's **Hendon Mob** profile and opens it in your browser. That sends the name to
  DuckDuckGo and, once your browser opens the page, connects you to The Hendon Mob.
- **Profile photo**: see §1.
- **Saving images.** The app saves images and videos (schedule exports, hand replays, overlays)
  to your photo library only when you choose "Save" in the share sheet. It does not read your
  photo library. You choose which photos to share with it.
- **Instagram Stories.** If you choose *Share to Instagram Story*, the image or video, and any
  background photo you picked, are handed directly to the Instagram app on your device. From that
  point Instagram's own privacy policy applies.

## 4. What other people can see

Some features exist so that others can see your information:

| Who | What they can see |
|---|---|
| Any registered member | Your username, full name and profile photo, when they search for you by username or name. |
| Anyone, without logging in | Your profile photo, if they know your account number. [CHECK: the avatar endpoint has no login check (`server.js:4306`). Keep it public, or require login?] |
| Your buddies (after you both accept) | Your schedule, live updates as you post them, and the fact that you logged a result. |
| Members of your groups | Group messages, the group's merged schedule, live updates, and, if the group turns its leaderboard on, each member's events played, cashes and results. |
| Anyone with your schedule share link | Your username, profile photo and full schedule, including conditional plans and personal-event notes. You can revoke the link at any time. |
| Anyone with a hand link, or anyone if you mark a hand public | That hand. |

## 5. Who else receives information

We use these service providers. Each one receives only what its feature needs:

| Provider | Why | What they receive |
|---|---|---|
| **Render** (render.com) | Hosts our servers and database. | Everything described in this policy. [CHECK: Render region (US?), and whether any other copy of the production database exists, such as backups or a copy on the operator's own computer.] |
| **Anthropic** (Claude API) | Reads Table Scanner photos. Admin-only tools also use it to turn typed hand descriptions into replays and to read tournament schedules. | The image or text submitted. We do not send your name, email or account details with it. [CHECK: Anthropic's API retention applies. Confirm the current terms and whether zero-data-retention is enabled, then state the period here.] |
| **OpenStreetMap Foundation** (Nominatim) | Finds places you search for and the state for your current location. | The search text, or your coordinates. Requests come from our server, not your device, and carry no account information. |
| **DuckDuckGo** and **The Hendon Mob** | Player profile lookups from the Table Scanner. | The player name you tapped. |
| **Apple Push Notification service** and browser push services | Delivering notifications. | A device or browser push token and the notification text. [CHECK: in the app today only administrators can turn on notifications. If notifications open to everyone at launch, say what they are used for.] |
| Email provider [CHECK: name the SMTP service behind `SMTP_HOST`, and confirm it is configured on Render. If it is not, reset links go to the server log instead of being emailed (`server.js:181`).] | Password-reset emails. | Your email address and the one-hour reset link. |
| **jsDelivr** | Supplies two font files when you export a PDF. | A standard web request from your device (your IP address). |

We also run our own services (dashboard.futurega.me and cashwatcher.futurega.me). They are used
only by the operator and receive no information about other users.

The live tournament clocks ask PokerAtlas and Bravo Poker Live for a room's clock. Those requests
carry only the event's or casino's identifier, never anything about you.

We do not sell or rent personal information, and we do not share it for advertising.

## 6. Payments

The app does not take payments today. A free trial is recorded against your account when you
start one. [CHECK: if in-app purchases or Stripe ship before or after launch, add a section
here. Apple or Stripe would process the payment, and we would receive only the subscription
status and transaction identifiers.]

## 7. Cookies and storage on your device

- **One cookie**: `fg_session`, a sign-in cookie set when you log in on the website. It is
  secure, cannot be read by page scripts, and lasts 90 days. There are no advertising or
  third-party cookies.
- **Device storage.** The app stores your sign-in token, username, name and photo, location and
  filter choices, display preferences, Table Scanner results, and drafts in your browser's or the
  app's local storage. If you sign in without "keep me signed in", the sign-in token is cleared
  when the session ends.

## 8. Analytics, advertising and tracking

None. The app contains no analytics, advertising or crash-reporting software, does not use
Apple's advertising identifier, and does not track you across other companies' apps or
websites.

Our hosting provider keeps routine request logs, which include IP addresses
[CHECK: Render's log retention period]. For security, our sign-in rate limits hold IP addresses in
memory for 15 minutes. Our own server logs can include usernames and error details.

## 9. How long we keep information

Today we keep account and activity data **until you delete it or delete your account**. Nothing
expires automatically, except push tokens that Apple or a browser reports are no longer valid.
Password-reset links stop working after one hour.
[CHECK: decide retention rules. Options include deleting used or expired password-reset
records, live updates older than N months, and server logs after N days. State them here once
implemented.]

## 10. Your choices and how to delete your data

- **Edit or remove** your name, profile photo, schedule entries, results (one at a time or all at
  once), live updates, saved hands, share links, buddies, groups and location at any time in the
  app.
- **Notifications** can be turned off in your device settings.
- **Location and camera** permissions can be withdrawn in your device settings. The app still
  works without them.
- **Delete your account.** [CHECK: an in-app *Delete Account* option is being built
  (`DELETE /api/account`). It must exist before App Store release, because Apple requires in-app
  deletion for apps with account creation. Once it ships, describe exactly what it removes,
  which should be everything in §1–§4 and push tokens, and anything kept: for example, whether
  hand links you shared stop working and what happens to group messages. Until then:] You can ask
  us to delete your account and data by emailing [CONTACT EMAIL] from the address on the account.
- **Copy of your data.** Email [CONTACT EMAIL] to request a copy.
  [CHECK: commit to a response time, and decide which regional rights statements you need
  (GDPR/UK, California). That depends on where you offer the app.]

## 11. Security

Passwords are hashed with bcrypt. All traffic to futurega.me uses HTTPS. Sign-in tokens expire
after 90 days (4 hours for guests), and sign-in attempts are rate-limited. No system is perfectly
secure. If we learn of a breach affecting your information, we will tell you. [CHECK: confirm you
are comfortable making that commitment.]

## 12. Age

futurega.me is a tool for poker players and is not directed at children.
[CHECK: state the minimum age, for example 18+ or 21+, consistent with the App Store age rating
you choose. Registration does not check age today.] If you believe a child has given us
information, contact us and we will delete it.

## 13. Backers

[CHECK: decide whether this section belongs in the app's policy. It describes the operator's
personal staking program (§8 of the inventory), not an app feature.]
People who back the operator's poker may receive a private link (futurega.me/b/…) showing their
own share of results. We store the backer's name and session results for that page. If the
backer opts in, we also store a browser push subscription, and we use their phone number (sent
by text message through **Twilio**) or email address (for a weekly summary). The backer page
loads fonts from **Google Fonts**.
[CHECK: the in-app Staking feature, which stores backers' names, emails, phone numbers and proof
images, is hidden from users today. If it launches, describe it here.]

## 14. Changes

If we change this policy we will update the effective date above. If a change is significant, we
will tell you in the app before it takes effect.

## 15. Contact

Questions or requests: [CONTACT EMAIL]
