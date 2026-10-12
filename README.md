# E&C Time Clock

| Page | URL | Who |
| --- | --- | --- |
| Employee punch clock | `https://app.eandccourier.ca/timeclock/` | Anyone added in the admin panel |
| Admin control panel | `https://app.eandccourier.ca/timeclock/admin.html` | `justin@ec.com` only (`ALLOWED_EMAIL` in `firebase-config.js`) |

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
- Only `justin@ec.com` can edit, add or delete punches, employees, schedules and settings.
- Employees can read the GPS list and nicknames, and set a GPS nickname, so a vehicle
  pick shows up in RouteWatcher.

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

In the admin panel: **Employees → Add employee**. Enter their name, email and weekly
start/end times. If they don't already have a login for the E&C apps, open *Create
their sign-in account* and set a starting password.

### 3. Employees add the clock to their phone

Have them open `app.eandccourier.ca/timeclock/`, sign in, and tap **Turn on** under
Reminders. On iPhone they have to *Add to Home Screen* first, then open the clock from
the home-screen icon. iOS only allows web notifications for home-screen web apps
(iOS 16.4 or later).

## How it works

- **Hold to punch.** Press and hold the ring for 1.5 seconds. A shorter press does
  nothing, so nobody punches by accident.
- **Vehicle pick.** After punching in, the driver picks a GPS unit. The list is the
  RouteWatcher GPS units that have a Device ID, shown by the name set in RouteWatcher
  Settings, not the nickname. Units another driver has taken are greyed out. Picking
  one sets the shared nickname at `developer/dispatch_dashboard/driver_nicknames/{gpsId}`
  to the driver's first name. RouteWatcher and DriverMap read nicknames from that path.
- **Punch out** frees the GPS and removes the nickname the driver gave it (only if
  nobody has changed it since).
- **Reminder.** If an employee is scheduled today and hasn't punched in by
  *start time + reminder minutes* (10 by default, set in **Settings**), the clock shows
  a phone notification and an in-page banner.
- **Admin edits** are marked "Edited by admin" on the employee's own screen, and each
  one is saved to the change log (`timeclock/audit`) with the reason.

## Reminders when the app is closed

`functions/` holds a Firebase Cloud Function, `timeclockPunchReminders`. It runs every
minute and sends a web push notification to any active employee who is scheduled
today and hasn't punched in by their start time plus the reminder delay. Each person
gets at most one per day. It stops trying at their scheduled end time, or 2 hours after
the reminder was due if no end time is set. A second function, `timeclockTestPush`,
powers the **Send test** button.

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

`database.rules.json` now also has `timeclock/push_tokens` and
`timeclock/push_tests`. Merge them in the same way as the rest (see step 1 above).

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

The first deploy may ask to turn on the Cloud Scheduler API. Say yes, because the
every-minute schedule runs on it.

#### Running cost (estimate from Google's published prices, October 2026, USD)

Running every minute is 43,200 runs a month (60 × 24 × 30). Each function has 1 vCPU
and 256 MiB of memory.

| Piece | Free allowance | Price after that | This feature |
| --- | --- | --- | --- |
| Function runs ([Cloud Run](https://cloud.google.com/run/pricing)) | 180,000 vCPU-s, 360,000 GiB-s, 2M requests a month, per billing account | $0.000024/vCPU-s, $0.0000025/GiB-s, $0.40/million requests | 21,600–129,600 vCPU-s (0.5–3 s per run): $0.55–$3.21 if no free allowance is left |
| Scheduler ([Cloud Scheduler](https://cloud.google.com/scheduler/pricing)) | 3 jobs per billing account | $0.10 per job per 31 days | 1 job: $0, or $0.10 if the account already has 3+ jobs |
| Database reads ([Firebase](https://firebase.google.com/pricing)) | ~10 GB/month (360 MB/day) | $1/GB | roughly 0.2–0.5 GB a month |
| Push notifications (FCM) | No-cost product | — | $0 |

On its own, this feature fits inside the free allowances. It only costs money if
the other apps on the same billing account have already used them up. In that case
the worst case is about **$0.90–$3.85 USD a month**. To see the real numbers, check
Google Cloud console → **Billing → Reports**, filtered by service.

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
