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

In the admin panel: **Employees → Add employee**. Enter their name, email and their
start time for each day they work. There's no end time, because drivers' hours vary. If they don't already have a login for the E&C apps, open *Create
their sign-in account* and set a starting password.

### 3. Employees add the clock to their phone

Have them open `app.eandccourier.ca/timeclock/`, sign in, and tap **Turn on** under
Reminders. On iPhone they have to *Add to Home Screen* first, then open the clock from
the home-screen icon. iOS only allows web notifications for home-screen web apps
(iOS 16.4 or later).

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
- **Punch out** frees the GPS and removes the nickname the driver gave it (only if
  nobody has changed it since).
- **Reminder.** If an employee is scheduled today and hasn't punched in by
  *start time + reminder minutes* (10 by default, set in **Settings**), the clock shows
  a phone notification and an in-page banner.
- **Admin edits** are marked "Edited by admin" on the employee's own screen, and each
  one is saved to the change log (`timeclock/audit`) with the reason.

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
