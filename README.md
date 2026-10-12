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

## Known limitation: reminders when the app is closed

The reminder comes from the time clock page, so it only fires while the page is open,
including in the background or as a home-screen app the phone hasn't closed. If the
phone has fully closed the page, no reminder is sent. Reminders with the app closed
need a server to send a push notification at the right time, such as a scheduled Cloud
Function using Firebase Cloud Messaging like the one in the `dispatch` repo.
