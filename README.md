# E&C Time Clock

| Page | URL | Who |
| --- | --- | --- |
| Employee punch clock | `https://app.eandccourier.ca/timeclock/` | Anyone added in the admin panel |
| Admin control panel | `https://app.eandccourier.ca/timeclock/admin.html` | `justin@ec.com`, `desirae@ec.com`, `celeste@ec.com` (`ADMIN_EMAILS` in `tc-core.js`) |

Both pages use the same Firebase project as RouteWatcher (`eandccourier-36fcc`).
`firebase-config.js` is a copy of the one in the `ogpoopdogg.github.io` repo.

## Set up before first use

### 1. Add the database rules (required)

The pages hide admin features from employees, but only the **Realtime Database
rules** actually stop an employee from changing their own punches.
`database.rules.json` holds the rules for this feature:

- Employees can create a punch-in and add a punch-out on their own shifts only. The
  time must be the server's current time (no backdating), and a time can't be changed
  after it is saved.
- Only the admins (`justin@ec.com`, `desirae@ec.com`, `celeste@ec.com`) can edit, add or
  delete punches, employees, schedules and settings. Admins can also read the GPS list
  and set GPS nicknames without being on the employee list.
- To add or remove an admin, change the email in **both** `ADMIN_EMAILS` in `tc-core.js`
  (lets them into the admin panel) and `database.rules.json` (lets them read and change
  the data), then publish the rules in the Firebase console. Each admin needs their own
  sign-in account under Firebase **Authentication**.
- Employees can read the GPS list and nicknames, and set a GPS nickname, so a vehicle
  pick shows up in RouteWatcher.
- An employee on the clock can take a van another driver has (**Van swap**), but only
  for their own open shift. Only the driver holding a van can release it.
- An employee on the clock can mark their own open shift as **Shop** (working in the
  shop, not driving).
- Each punch and van swap can save where the phone was, once, within 5 minutes of the
  punch. Only the admin panel writes the street address.
- Each employee can read and change only their own punch-in reminder setting
  (`timeclock/prefs`).

Firebase console → **Realtime Database** → **Rules**: merge the `timeclock` block and
the `developer/dispatch_dashboard/drivers` and `driver_nicknames` entries into your
existing rules. Don't replace the whole file, or you'll remove the rules your other
apps rely on.

**Important:** in Realtime Database rules, a `.read`/`.write` that allows access at a
parent path can't be taken back at a child path. If your current rules have something
like `".write": "auth != null"` at the root or on a parent of `timeclock`, any
signed-in user could still edit punches. Those broad rules need to be narrowed for the
lock to hold.

### 2. Add employees

In the admin panel: **Employees → Add employee**. Enter their name, email and their
start time for each day they work. There's no end time, because drivers' hours vary. If they don't already have a login for the E&C apps, open *Create
their sign-in account* and set a starting password.

### 3. Employees add the clock to their phone

Have them open `app.eandccourier.ca/timeclock/`, sign in, and tap **Turn on** under
Reminders. On iPhone they have to *Add to Home Screen* first, then open the clock from
the home-screen icon. iOS only allows web notifications for home-screen web apps
(iOS 16.4 or later).

## Overtime

Hours are split into **regular** and **overtime**, with each hour counted only once:

- **Daily:** within a day, the first 8 hours worked are regular and the rest is overtime.
- **Weekly:** regular hours add up through the week in time order. Once they pass 40,
  any further hours are overtime. Daily overtime hours don't count toward the 40.

Weeks always run **Friday to Thursday** (payday is Friday; `PAY_WEEK_START` in
`tc-core.js`). A `weekStart` saved in `timeclock/settings` by an older version is
ignored. Timesheets, the CSV export, the employees' "My week" and the weekly 40 hours
all use it. A shift counts
on the day it started, as for regular hours. For example, five 9-hour days give 40
regular + 5 overtime, and six 8-hour days give 40 regular + 8 overtime. Where the split
shows:

- **Employees:** a Regular / Overtime split under the week total, an orange overtime
  part on each day's bar, and an OT tag on each punch with overtime.
- **Admin:** Reg / OT on each timesheet, OT per day and per punch, the overtime share
  of "Hours this week" on the live board, and **Regular** and **Overtime** columns in
  the CSV export.

The thresholds are `DAILY_OT_MS` and `WEEKLY_OT_MS` in `tc-core.js`.
`tests/overtime.test.mjs` checks the rules.

## Installing the app, and how updates reach it

Both pages install as apps: the time clock as **E&C Clock**, the admin panel as
**Clock Admin**. Each has its own icon.

- **Android, or Chrome/Edge on a computer:** tap **Install** in the top bar, or use the
  browser menu → *Install app* / *Add to Home screen*.
- **iPhone/iPad:** open the page in Safari → **Share** → **Add to Home Screen**. The
  **Install** button shows these steps.

**Updates are automatic.** Edit and commit the files on GitHub as usual. There's no
version number to change, and nobody needs to reinstall or clear anything.
- **Opening the app:** the service worker (`sw.js`) asks the server for the newest copy
  of every file each time the app opens. A saved copy is used only when the phone is
  offline, so the app still opens without signal.
- **App left open:** `pwa.js` checks for changes whenever someone returns to the app, and
  every 20 minutes. When something changed, it shows "Updating to the latest version…"
  and reloads by itself. It never does this in the middle of a punch or a vehicle pick,
  or while an admin edit window is open or a field is being typed in. It waits until
  that's finished.

GitHub Pages usually takes a minute or two to publish a commit. After that, the next
open (or the next check) picks it up.

## How it works

- **Hold to punch.** Press and hold the ring for 1.5 seconds. A shorter press does
  nothing, so nobody punches by accident.
- **Vehicle pick.** After punching in, the driver picks a GPS unit. The list is the
  RouteWatcher GPS units that have a Device ID, shown by the name set in RouteWatcher
  Settings, not the nickname. Units another driver has taken are greyed out. Picking
  one sets the shared nickname at `developer/dispatch_dashboard/driver_nicknames/{gpsId}`
  to the driver's first name. RouteWatcher and DriverMap read nicknames from that path.
- **Shop.** The first tile in the vehicle list is **Shop**, for employees working in the
  shop instead of driving. It is saved on the shift (`shop: true`), and if they had a van
  it is released. They can switch between Shop and a van any time while on the clock.
  The admin live board and timesheet show a **Shop** tag, the CSV's GPS column says
  *Shop*, and the admin can set or remove Shop when editing a punch.
- **Van swap.** While on the clock, the big **Van swap** button under the punch ring
  opens the van list. Vans other drivers have can be picked too. The app asks "Van 7 is
  assigned to Matt. Take it?", then:
  - The van moves to the driver who took it (and its RouteWatcher nickname with it).
  - The server (`timeclockVanTaken`) unassigns the driver who had it and sends them a
    notification right away: *"Dave took van 7. Are you in van 3 now? …"* (van 3 being
    the one Dave left). Tapping it opens the van list with van 3 first, marked
    *Likely yours*, so a straight swap is one tap.
  - If they still haven't picked a van, they're reminded every 10 minutes, 3 times at
    most. The reminders stop as soon as they pick a van or punch out. Van swap
    alerts are sent even if they turned the punch-in reminder off.
  - While they have no van, their clock shows a red "Dave took van 7" bar and a banner,
    and the admin live board shows **Needs van swap**.
  - The app can't tell which van a driver is sitting in. It only knows what drivers pick.
    That's why the bumped driver is asked rather than moved automatically.
- **Van history.** Every van pick, swap, move to the shop and "taken by" is saved on the shift with its time
  (and location). The admin timesheet shows the whole list, and the CSV has a
  **Van changes** column.
- **Punch out** frees the GPS and removes the nickname the driver gave it (only if
  nobody has changed it since, and only if another driver hasn't taken the van).
- **Reminder.** If an employee is scheduled today and hasn't punched in by
  *start time + reminder minutes* (10 by default, set in **Settings**), the clock shows
  a phone notification and an in-page banner.
- **Reminder on/off is saved.** The **Turn on / Turn off** choice is saved in Firebase
  (`timeclock/prefs/{ek}/punchReminder`), not on the phone. It stays the way the driver
  left it until they change it, after reinstalling the app, signing out or switching
  phones. On a new phone the card says the reminder is on and shows **Allow**, because
  each phone still has to allow notifications once. Drivers who turned reminders on
  before this was added are saved as "on" the next time they open the clock.
  **Admin → Employees** shows *Reminder off* for anyone who turned it off.
- **Admin edits** are marked "Edited by admin" on the employee's own screen, and each
  one is saved to the change log (`timeclock/audit`) with the reason.

## Punch locations

Each punch in, punch out and van swap saves where the phone was: latitude, longitude
and accuracy in metres. The phone's location is asked for when the punch is made, and
saved right after, so a slow GPS fix never delays the punch. The app waits up to 10
seconds for a fix.

If the phone blocks location, or there's no fix within 10 seconds, the punch still
goes through. The admin timesheet shows *No location* with the reason (blocked, timed
out, unavailable).

The first punch makes the phone ask the driver to allow location. On iPhone, the
setting is under **Settings → Privacy & Security → Location Services**, for Safari
websites or the home-screen app.

**Admin:** each punch time in **Timesheets** has its street address underneath. Tap the
address for a window with a Google map pinned to the spot, with a circle showing the
accuracy, the coordinates, and an **Open in Google Maps** link. The CSV export has **In
location** and **Out location** columns. Older punches (from before this was added) and
punches the admin added by hand have no location.

### Where the addresses and map come from

The admin panel uses the **Google Maps key RouteWatcher already uses**, which is copied into
`maps-config.js`. It's a browser key, restricted to the E&C website, and it already
allows the Maps JavaScript API and Google's geocoder. No new key or Google Cloud setup is
needed.

- **Addresses** are looked up in the admin panel, not on the server. Google refuses
  website-restricted keys for server requests. When Timesheets or the Live board loads
  punches, any location without an address is looked up once, with Google's geocoder,
  and saved on the shift. Every later visit, and the CSV, just reads the saved address.
  So a punch shows "Finding address…" only until the admin panel has been opened once
  after it.
- **The map** in the location window is drawn with the same Maps JavaScript API.
- If RouteWatcher's key is ever changed or restricted further, update `maps-config.js`.
  Until then the admin panel shows coordinates and the Google Maps link instead.

### Cost

These figures come from third-party summaries (October 2026), not Google's own page,
so **check them** at <https://developers.google.com/maps/billing-and-pricing/pricing>
before you rely on them:

- Since March 2025, Google gives each Maps "Essentials" product a monthly number of free
  requests instead of the old $200 credit. Geocoding and Dynamic Maps (map loads) are
  reported at **10,000 free a month each**.
- This app makes one address lookup per location saved: punch in, punch out and each
  van pick or swap. For example, 10 drivers × 22 days × 3 locations a day = **660 a
  month**. A map load happens only when the admin opens a punch's location window.
- These requests count toward the same key and Google Cloud project as RouteWatcher's
  maps.

## Reminders when the app is closed

`functions/` sends each employee **one** reminder, only on days they're scheduled,
and only if they haven't punched in by their start time plus the reminder delay.
It uses one-shot timers ([Cloud Tasks](https://cloud.google.com/tasks/docs)) instead
of checking all day:

- `timeclockPlanReminders` runs once a day at 12:01 AM (Brandon time) and sets one
  timer per employee scheduled that day, for exactly start + reminder delay.
- `timeclockPunchReminder` is what each timer runs. If the person hasn't punched in,
  their phones get the notification. Otherwise nothing is sent.
- `timeclockReplanEmployee` and `timeclockReplanAll` move a timer when you change
  someone's schedule, or the reminder delay, during the day. A timer whose time no
  longer matches the schedule does nothing when it fires.
- `timeclockTestPush` powers the **Send test** button.
- `timeclockVanTaken` and `timeclockVanSwapReminder` handle van swaps (see
  *How it works → Van swap*). They use the same Cloud Tasks timers.

Each person gets at most one reminder per day. If a schedule is changed after the
reminder time has already passed, the reminder is sent right away, unless it's more
than 2 hours late.

Until the steps below are done, phones only get the reminder while the time clock is
open. Nothing else changes.

### 1. Get the two keys from Firebase

Firebase console → project **eandccourier-36fcc** → ⚙ **Project settings**:

1. **General** → *Your apps*. If there's no **Web** app (`</>`), click *Add app* → Web,
   name it `E&C Time Clock`, and leave Hosting unticked. Copy its `appId`
   (it looks like `1:1067680083511:web:…`).
2. **Cloud Messaging** → *Web configuration* → *Web Push certificates* →
   **Generate key pair**. Copy the key.

Paste both into `push-config.js` and commit the change.

### 2. Add the database rules

`database.rules.json` now also has `timeclock/push_tokens`, `timeclock/push_tests`,
`timeclock/prefs` (the reminder on/off choice), the location and van-history fields on
shifts, and the van-swap rule on `timeclock/vehicle_claims`. Merge them in the same way
as the rest (see step 1 above).

### 3. Deploy the functions (once, and again whenever `functions/` changes)

The easiest way, with nothing to install, is **Google Cloud Shell**
(<https://shell.cloud.google.com>), signed in with the Google account that owns the
Firebase project:

```sh
git clone https://github.com/ogpoopdogg/timeclock.git
cd timeclock/functions && npm install && cd ..
npx firebase-tools login --no-localhost
npx firebase-tools deploy --only functions:timeclock --project eandccourier-36fcc
```

`firebase.json` puts these functions in their own *codebase* called `timeclock`, and
the command above deploys only that codebase. The dispatch app's functions
(`notifyStaffOnRequest`, `sendTestPush`) and `fleetHuntHistory`, `pajApi` and
`pollNow` in the same project are left alone. If the CLI ever asks whether to delete
other functions, answer **No**.

The first deploy may ask to turn on the **Cloud Scheduler** and **Cloud Tasks** APIs.
Say yes to both: the daily planner runs on Cloud Scheduler, and the timers on Cloud
Tasks.

#### After the first night: check the timers were set

Firebase console → **Functions** → **Logs** (or Google Cloud console → *Logging*).
After 12:01 AM, `timeclockPlanReminders` should log *"Punch-in reminder timers"*,
with *"set for …"* next to everyone scheduled that day.

If it logs a **permission denied** error instead, the functions' service account
can't create timers yet. Whether this happens depends on how the project's default
permissions were set up, which can't be seen from this repo. Fix it once, in Cloud Shell:

```sh
PROJECT=eandccourier-36fcc
SA="$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for ROLE in roles/cloudtasks.enqueuer roles/iam.serviceAccountUser roles/run.invoker roles/cloudfunctions.invoker; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="$ROLE" --condition=None
done
```

Why each one:
- **Cloud Tasks Enqueuer** lets the planner create timers.
- **Service Account User** lets each timer call the reminder function as that account.
- The two **Invoker** roles let the timer start the function. The `firebase-functions`
  library lists the Enqueuer and Invoker roles as the permissions task functions need.

#### Running cost (estimate from Google's published prices, October 2026, USD)

Runs scale with the number of reminders, not with time. For example, with 10
employees each scheduled 22 days a month, that's 30 planner runs + 220 timers =
**about 250 runs a month**. Each function has 1 vCPU and 256 MiB of memory.

| Piece | Free allowance | Price after that | This feature (10 employees) |
| --- | --- | --- | --- |
| Function runs ([Cloud Run](https://cloud.google.com/run/pricing)) | 180,000 vCPU-s, 360,000 GiB-s, 2M requests a month, per billing account | $0.000024/vCPU-s, $0.0000025/GiB-s, $0.40/million requests | 125–750 vCPU-s (0.5–3 s per run): $0.003–$0.02 if no free allowance is left |
| Timers ([Cloud Tasks](https://cloud.google.com/tasks/pricing)) | 1,000,000 operations a month, per billing account | $0.40 per million | about 440 (create + deliver): $0 |
| Daily planner ([Cloud Scheduler](https://cloud.google.com/scheduler/pricing)) | 3 jobs per billing account | $0.10 per job per 31 days | 1 job: $0, or $0.10 if the account already has 3+ jobs |
| Database reads ([Firebase](https://firebase.google.com/pricing)) | ~10 GB/month (360 MB/day) | $1/GB | well under 0.01 GB |
| Push notifications (FCM) | No-cost product | — | $0 |

On its own, this feature fits inside the free allowances. Even if the other apps on
the billing account have used them all, the worst case is about **$0.12 USD a month**,
almost all of it the scheduler's $0.10. To see the real numbers, check Google Cloud
console → **Billing → Reports**, filtered by service.

### 4. Turn it on for each phone

Each employee opens the time clock and taps **Turn on** under Reminders. Phones that
already allowed notifications register by themselves the next time the clock opens.
The card then says *"This phone gets it even when the time clock is closed"*, and
**Send test** sends a notification through the server.

**Admin → Employees** shows *1 phone* (or more) next to everyone who will get
closed-app reminders, and *No phone alerts* for everyone who won't.

On iPhone, the clock must be added to the Home Screen and opened from there (iOS 16.4
or later). The page checks whether the browser supports this kind of push, and falls
back to the open-app reminder if it doesn't.
