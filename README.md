# E&C Time Clock

| Page | URL | Who |
| --- | --- | --- |
| Employee punch clock | `https://app.eandccourier.ca/timeclock/` | Anyone added in the admin panel |
| Admin control panel | `https://app.eandccourier.ca/timeclock/admin.html` | `justin@ec.com`, `desirae@ec.com`, `celeste@ec.com` (`ADMIN_EMAILS` in `tc-core.js`) |

Both pages use the same Firebase project as RouteWatcher (`eandccourier-36fcc`).
`firebase-config.js` is a copy of the one in the `ogpoopdogg.github.io` repo.

## Set up before first use

### 1. Database rules (required)

The pages hide admin features from employees, but only the **Realtime Database
rules** actually stop an employee from changing their own punches. The rules are kept
only in the Firebase console (**Realtime Database** → **Rules**), not in this repo.

- To add or remove an admin, change the email in **both** `ADMIN_EMAILS` in `tc-core.js`
  (lets them into the admin panel) and the database rules in the Firebase console (lets
  them read and change the data). Each admin needs their own sign-in account under
  Firebase **Authentication**.
- **Order when updating:** publish any rules change in the Firebase console soon after the
  pages update. If `functions/` changed, deploy the functions too (see *Server functions →
  Deploying*).
- In Realtime Database rules, a `.read`/`.write` that allows access at a parent path
  can't be taken back at a child path, so a broad rule on the root or on a parent of
  `timeclock` would undo the punch lock.

### 2. Add employees

In the admin panel: **Employees → Add employee**. Enter their name, email and their
start time for each day they work. There's no end time, because drivers' hours vary. If they don't already have a login for the E&C apps, open *Create
their sign-in account* and set a starting password.

**Removing someone** hides them from the clock, the live board and the employee list
(**Show removed** brings them back into view) and frees any van they had. Their punches
stay, so old timesheets and the CSV still include them. **Add back** undoes it.

**Someone on the clock** can't punch out once they're removed or turned off, so removing
them, or saving them with *Active* off, first asks **Punch them out now?** OK punches them
out and frees their vehicle. Cancel leaves them on the clock, and they stay on the live
board (marked *removed* or *turned off*) until someone punches them out there.

**Turned off with a schedule:** someone saved with *Active* off still shows on the live
board (**Who's working**) as *Turned off* while they have a start time on any day, so
nobody with a schedule goes missing from it. Their **Edit** button opens them to turn
*Active* back on.

**Forgotten password:** the sign-in emails aren't real inboxes, so a password can't be
reset by email. Add the person again with a new sign-in email and pick their old record
under **Takes the place of**. Their punches, requests, schedule and vehicle move to
the new sign-in, and the old record is deleted. The change log records the move.

### 3. Employees add the clock to their phone

Send them the link `app.eandccourier.ca/timeclock/`. On a phone the install steps open
by themselves; they follow them, open the clock from the new icon, and sign in.

## Overtime

Hours are split into **regular** and **overtime** by day only: within a day, the first
8 hours worked are regular and the rest is overtime. There is **no weekly overtime**;
a week's regular and overtime are just its days added up, however many hours that is.

Weeks always run **Friday to Thursday** (payday is Friday; `PAY_WEEK_START` in
`tc-core.js`). A `weekStart` saved in `timeclock/settings` by an older version is
ignored. Timesheets, the CSV export and the employees' "My week" all use it. A shift
counts on the day it started, and all shifts started on the same day count toward that
day's 8 hours. For example, five 9-hour days give 40 regular + 5 overtime, and six
8-hour days give 48 regular + 0 overtime. Where the split shows:

- **Employees:** a Regular / Overtime split under the week total, and the overtime under
  each day's hours in My week (in the same colors as regular time). Tapping a day in My
  week shows that day's exact punch in and out times and its hours.
- **Admin:** Reg / OT on each timesheet, OT per day and per punch, the overtime share
  of "Hours this week" on the live board, and **Regular** and **Overtime** columns in
  the CSV export.

The threshold is `DAILY_OT_MS` in `tc-core.js`.

### 15-minute blocks

Hours are counted in 15-minute blocks. Each punch in and punch out counts as the nearest
quarter hour: 7 minutes or less past a quarter rounds down, 8 or more rounds up. For
example, a punch out at 5:01 or 5:07 counts as 5:00, and 5:08, 5:14 or 5:17 count as
5:15. Seconds are ignored. The saved punch times don't change. Every total uses the
counted times: timesheets, the CSV, overtime, the Reports hours and overtime, and the employees' My week. The
admin timesheet shows *Counts as 5:15 PM* under any punch that was rounded, and the CSV
has **Counted in** and **Counted out** columns. The rule is `roundPunch` in `tc-core.js`.
`tests/overtime.test.mjs` checks the rules.

## Installing the app, and how updates reach it

Both pages install as apps: the time clock as **E&C Clock**, the admin panel as
**Clock Admin**. Each has its own icon (`apple-touch-icon.png` is the iPhone one).

The yellow **Install** button in the top bar shows until the app is installed:

- **Android (Chrome, Edge):** one tap opens the phone's own install prompt.
- **iPhone/iPad in Safari:** it opens a few big, short steps with pictures of the
  buttons to tap, and a bouncing yellow arrow pointing at the first one (••• at the
  bottom right on iOS 26, Share in the middle of the bottom bar before that). The
  steps stay on screen while they tap along in Safari.
- **Other Android browsers:** a short list of the menu steps. Chrome or
  Firefox on an iPhone get their own steps, with a link to copy into Safari.
- **Opened inside another app** (the link was tapped in Facebook, Instagram, Gmail
  and the like): those can't install it, so the steps say to copy the link and open it
  in Safari (iPhone) or Chrome (Android), with a **Copy** button.
- **Computer:** the steps for Chrome/Edge, or File → Add to Dock in Safari on a Mac.

On a phone the steps also open by themselves when the page is opened in the browser,
at most once a day. On Android that only happens while Chrome offers to install it
(it stops once it's installed). An iPhone can't tell the page it's installed, so the
steps have an **It's installed** button that stops them opening by themselves (the
Install button stays). The installed app never shows any of this. On iPhone the
installed app may ask the person to sign in once more.

**Phones too old for the app** (Safari before version 15, for one) can't run it. If the clock
hasn't started after 10 seconds, it says to check the signal and, if it never starts, to update
the phone's software or ask the office.

**Updates are automatic.** Edit and commit the files on GitHub as usual. There's no
version number to change, and nobody needs to reinstall or clear anything.
- **Opening the app:** the service worker (`sw.js`) opens the app straight from the copy
  saved on the phone, so it appears at once, signal or not. At the same time it asks the
  server for the newest copy of every file. Only when all of them have arrived does it
  replace the saved copy, and if anything changed the app shows "Updating to the latest
  version…" and reloads by itself. The Firebase code and fonts the pages load from Google
  are saved too. If a new version ever fails to start (a broken commit), the page reloads
  to the next fixed version by itself as soon as the service worker has it, so phones
  don't stay stuck on it.
- **App left open:** `pwa.js` has the service worker check again whenever someone
  returns to the app, and every 20 minutes, and reloads the same way. It never does this in the middle of a punch or a vehicle pick,
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
- **Vans without GPS.** Under **Admin → Vehicles → Vans without GPS**, type a van's name
  (like *Van 12*) to add it. It shows up in the drivers' van list mixed in with the GPS
  vans, in name order, and works the same way: one driver at a time, Van swap, van checks,
  van history and Reports. It just has no RouteWatcher nickname. If a GPS unit in
  RouteWatcher is later given the same name (*Van 12* or *12*), drivers see the GPS unit
  instead, and Reports counts both as one van. **Remove** takes a van off the list; past
  punches keep its name. Saved in `timeclock/vans`.
- **Shop.** The first tile in the vehicle list is **Shop**, for employees working in the
  shop instead of driving. It is saved on the shift (`shop: true`), and if they had a van
  it is released. They can switch between Shop and a van any time while on the clock.
  The admin live board and timesheet show a **Shop** tag, the CSV's GPS column says
  *Shop*, and the admin can set or remove Shop when editing a punch.
- **Change vehicle.** While on the clock, the big **Change vehicle** button under the punch ring
  opens the van list. Vans other drivers have can be picked too. The app asks "Van 7 is
  assigned to Matt. Take it?", then:
  - The van moves to the driver who took it (and its RouteWatcher nickname with it).
  - The server (`timeclockVanTaken`) unassigns the driver who had it. There is no phone
    notification (removed October 2026): the next time they open the clock, it shows a
    red "Dave took van 7" bar and a *Vehicle swap needed* banner. Tapping the banner
    opens the van list with the van Dave left first, marked *Likely yours*, so a
    straight swap is one tap.
  - The admin live board shows **Needs van swap** until they pick a van or punch out.
  - The app can't tell which van a driver is sitting in. It only knows what drivers pick.
    That's why the bumped driver is asked rather than moved automatically.
- **Van history.** Every van pick, swap, move to the shop and "taken by" is saved on the shift with its time
  (and location). The admin timesheet shows the whole list, and the CSV has a
  **Van changes** column.
- **Punch out** frees the GPS and removes the nickname the driver gave it (only if
  nobody has changed it since, and only if another driver hasn't taken the van).
- **Late.** If an employee is scheduled today and hasn't punched in by *start time +
  late minutes* (10 by default, **Settings → Late after**), the admin live board shows
  them as **Late**. There is no punch-in reminder on the phone (removed October 2026).
- **Long shifts (a forgotten punch out).** A driver who punches out after at least the
  long-shift hours (14 by default, **Settings → Long shift**, 4 to 24, the same for every
  driver) is asked *Did you forget to punch out?*. **Fix a punch** opens on a missed
  punch out for the day the shift started, so they can send the time they really
  finished. Every shift that long (or still on the clock that long) also shows in
  **Admin → Inbox → Long shifts** and is tagged **Long shift** on the timesheet, until an
  admin edits it or taps **It's right** (saved as `longSeen` on the shift).
- **Admin edits** show as *Changed by the office* (or *Added by the office*) when the
  driver taps that day in My week, and each one is saved to the change log
  (`timeclock/audit`) with the reason.

## Time

All times are Brandon, MB time, whatever the phone or computer is set to. Manitoba stopped
changing its clocks: it stays on UTC-5 all year, starting 2026-11-01 (it no longer falls
back). A device only knows that once its own software has been updated, so from that
date `tc-core.js` works out Brandon time itself (UTC-5) instead of asking the device;
earlier punches use the device's time zone rules, which are right for the past
(`FIXED_OFFSET_FROM`). If Manitoba ever changes its clocks again, that is the place to
change. Punch times themselves are always the server's clock, not the phone's.

## No signal

A punch works with no signal. The app saves it on the phone right away (with the time
it was pressed) and a bar at the top says it's waiting. It's sent when the phone is
back online, or the next time the app is opened if it was closed first (an iPhone pauses
the app once it's closed, so that can be hours later). The punch is saved with the time the
server receives it, and the time pressed is saved with it. When the two are more than 2
minutes apart:

- **Punch out sent late:** the hours count to the time it was pressed (`countedOut` in
  `tc-core.js`). That can only lower the hours, so it can't be used to gain time. The
  timesheet shows **Punch out sent late · counted from 5:00 PM**, and the driver's My week
  says *counted from when you pressed it*.
- **Punch in sent late:** it counts from when it reached the server until the office
  chooses, because a phone's time can be changed. It shows in **Admin → Inbox → Late
  punches** (from the punches loaded, about the last three weeks): **Use the phone's time**
  moves the punch in to the time pressed (logged like any edit), **Keep the server's time**
  keeps it (saved as `lateSeen` on the shift). The timesheet tags it **Punch in sent late ·
  pressed 7:02 AM**, and editing the punch also has a **Use the phone's time** link.

An admin who changes a punch out's time replaces the phone's time (`outTap` is removed).

Where the phone was at a no-signal punch is saved on the phone with the punch, and sent
right after it, so it isn't lost if the app is closed before the signal comes back.

Picking a vehicle needs signal, because the server decides who has which vehicle. With
none, the vehicle picker says so, and the list loads by itself when the signal is back
(or the driver taps **Try again**, or closes it and picks later). Signing out works with
no signal too, but while a punch is still waiting to be sent it asks first: the punch is
only sent from that phone, once the same person signs in on it again.

The clock **opens instantly**, with or without signal. The phone keeps a copy of what the
clock screen shows: who is signed in, their punches of the last three weeks, and the
settings (`tc_offline` in the browser's storage, cleared on sign-out).
The clock shows from that copy straight away, and the server's data replaces it as soon as
it arrives. With no signal a driver can still punch. The loading spinner only shows on a
phone's very first sign-in.

Sign-in is set up without Firebase's pop-up/redirect helper (`initializeAuth` in
`tc-core.js`): on phones that helper was downloaded from Google on every open before
Firebase would say who is signed in, which held up the driver's data and the sending of
punches. Only email and password sign-in is used, which doesn't need it.

## Requests, the Inbox and Reports

**Employees** have a **Requests** card on the clock:

- **Fix a punch:** for a missed punch in or out, both, a wrong time, a punch in by
  accident (the driver picks which punch that day), or anything else, with the day, the
  times and a note.
- Each request shows whether it's waiting, done or declined, with the admin's reply. A
  request can be cancelled while it's still waiting.
- **Vehicle Check:** after picking a vehicle, the app asks if anything is wrong with it
  (tap **All good** to skip). The *Something wrong with this vehicle? Report it* link
  under the vehicle sends a report any time.
- **Oil check:** on a shift with a vehicle (not Shop or *Not driving today*) whose oil
  check is due (see **Garage → Oil schedule**), a
  *Please check your oil* reminder pops up after the Vehicle Check, and a glowing **Oil
  check** box stays under the vehicle until the driver taps it and ticks *I checked the
  oil*. If they never did, punching out asks *Did you check the oil?*, and the answer
  (checked or not) is saved on the shift. Only **Save** closes that question, so a stray
  tap outside it doesn't count as "not checked". It works with no signal, like a punch.
  When the vehicle isn't due, nothing is asked.
- **Vehicle swaps:** the driver handing a vehicle off is the one responsible for its oil.
  If they haven't ticked the oil check yet that shift, they're asked *Did you check the
  oil?* about that vehicle right away: when they tap **Change vehicle** and pick another
  vehicle, or, when another driver takes theirs, as soon as their app sees it (and before
  they pick the vehicle they're in now). The answer, yes or no, settles the shift's oil: no
  more oil questions that shift, not at punch out either. The driver getting a vehicle
  another driver had today (taken from them, or the one they left behind) gets no Vehicle
  Check and no oil question for it; their shift is saved as *Oil not due*. A vehicle
  nobody was driving (picked up from the lot, or after Shop) is a normal pick.
- **Last pay week:** the total, regular and overtime hours for the last full pay week.

**Admin → Inbox** lists punch fixes and late punch ins (see *No signal*), with a count on the tab. **Fix it** opens the punch
editor already filled in from the request, and saving marks the request done. It opens
the driver's own punch for that day (or the one from the day before that ran past midnight),
so the fix changes that punch instead of adding a second one; only *Missed a whole shift*
adds a new punch. Saving a punch that overlaps another of that employee's punches asks
first, since both would count the same hours. For a
punch in by accident it opens that punch, and **Delete punch** (after a confirm) removes the
whole shift and marks the request done. **Show
handled** shows the finished ones. The live board and timesheets also tag each shift *Oil
checked*, *Oil not checked*, or *Oil not due* (the vehicle's check wasn't due).

**Vehicle problems, oil checks and the oil check schedule are in Garage**
(`app.eandccourier.ca/garage/`, the [garage](https://github.com/ogpoopdogg/garage) repo), with
everything else saved about each vehicle. The admin panel links to it from the Inbox and
**Vehicles**. Garage reads and writes the same `timeclock/van_reports`, the oil check on each
shift, `timeclock/oil_plan` and `timeclock/oil_last`, so the clock works the same as before.

**Admin → Reports** shows the hours, overtime and overtime share for **Last week** (the
last full pay week, Friday to Thursday), **Last month** (the last calendar month), **Last
year** (the last calendar year) or a **Custom range** (up to 400 days), a table of each
person's overtime (brighter orange is more overtime), and hours driven per vehicle. The table
has a column per pay week for periods up to 3 months, and a column per month for longer
ones. Hover over any cell or bar for the numbers.

**Other admin tools:**

- **Export CSV** takes any date range (or *This pay week*, *Last pay week*, *This month*,
  *Last month*), with every punch and a total per pay week, or one line per employee.
  A cell that starts with = + - or @ gets a ' in front, so Excel keeps it as text instead
  of running it as a formula.
- **Settings → Shop location:** punches made farther than the set distance from the shop
  show **Far from shop** on the timesheet. **Pick on the map** opens a map where you
  search an address or tap to drop the pin (drag it to move it).
- **Settings → Punch spots:** places other than the shop where some drivers start and end
  their day (Winnipeg, say), each with a name, a pin on the map and its own distance.
  Saved in `timeclock/spots`. Give a driver their spot on **Staff → Edit → Punch spot**
  (saved as `spot` on the employee). Their punches in and out then show
  **Far from (spot name)** when farther than that spot's distance, including a punch at
  the shop. Shifts in the shop (Shop picked, or set by an admin) are still checked against
  the shop. The flag is worked out when the timesheet is shown, so changing or removing a
  driver's spot changes the flag on their old punches too. Removing a spot puts its
  drivers back on the shop. **Takes the place of** brings the old sign-in's spot along.
- **Settings → Change log** includes employee changes (added, edited, removed, added back,
  moved to a new sign-in), can be filtered to one person, and loads older changes on
  request.

## Punch time reminder

A one-time message for drivers who punch in before they get to work or punch out after
they get home. In **Staff → Punch time reminder**, tick the drivers who should see it and
save. The next time each of them opens the clock, a pop-up asks them to punch in when they
arrive at work and punch out before they leave for home. Tapping outside it doesn't close it. Only the
**I have read and understand** button does.

- Which drivers get it is saved at `employees/<ek>/notices/punch`. Their tap is saved with the
  server's time at `timeclock/notice_acks/<ek>/punch`. The list shows *Waiting for them to
  read it* or *Agreed …*, and Staff shows *Punch time reminder: agreed …* under their name.
- It shows once per driver, on any phone. **Show again** next to someone who agreed (then
  Save) clears their answer, so they see it one more time. Unticking and ticking someone
  who agreed does the same.
- **Takes the place of** carries the tick and the answer over to the new sign-in.
- **Database rules:** drivers can only save their own answer, only once, only while
  they're ticked, and only with the server's time. Paste this block inside
  `"timeclock": { … }` in the Firebase console, right above `"vehicle_claims": {`:

```json
      "notice_acks": {
        "$ek": {
          ".read": "auth != null && auth.token.email.toLowerCase().replace('.', ',') === $ek",
          "$notice": {
            ".write": "auth != null && auth.token.email.toLowerCase().replace('.', ',') === $ek && root.child('timeclock/employees').child($ek).child('notices').child($notice).val() === true && !data.exists() && newData.exists()",
            ".validate": "newData.isNumber() && newData.val() === now"
          }
        }
      },
```

  Until those rules are published, the pop-up doesn't show at all (the clock can't read
  the answers yet), so nothing breaks if the pages update first.

## Change vehicle reminder

A second one-time message, set up the same way: **Staff → Change vehicle reminder**, tick
the drivers, save. The pop-up (marked *Important* in red) asks them to tap **Change vehicle**
every time they change vehicles, including swaps where both drivers must tap it, because
dispatch sees who is driving each vehicle from it. It shows a copy of the vehicle bar with an
arrow pointing at the button, says it's mandatory for every vehicle change, and ends with
*Questions? Please call or text…*. Only **I have read and understand** closes it.

- Saved at `employees/<ek>/notices/vehicle` and `timeclock/notice_acks/<ek>/vehicle`, with the
  same **Show again**, Staff status line and **Takes the place of** behaviour as the punch
  time reminder.
- A driver ticked for both sees the punch time reminder first, then this one.
- **No rules change:** the `notice_acks` rules above work for any reminder.
## Punch locations

Each punch in, punch out and van swap saves where the phone was: latitude, longitude
and accuracy in metres. The phone's location is asked for when the punch is made, and
saved right after, so a slow GPS fix never delays the punch. The app waits up to 10
seconds for a fix.

If the phone blocks location, or there's no fix within 10 seconds, the punch still
goes through. The admin timesheet shows *No location* with the reason (blocked, timed
out, unavailable).

The clock screen says, under the punch button, that the phone's location is saved with each punch and
vehicle change, and links to the staff notice at `app.eandccourier.ca/privacy/staff.html` (the `privacy`
repo), which lists everything E&C records about staff. Each employee should sign a copy.

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

## Server functions

`functions/` has two functions:

- `timeclockVanTaken` unassigns a driver whose vehicle another driver took (see
  *How it works → Van swap*).
- `timeclockBeforeUserCreated` refuses @ec.com sign-ins the admin panel didn't make (see
  *Only admins can make @ec.com sign-ins* below).

**There are no phone notifications any more** (removed October 2026): no punch-in
reminder and no vehicle swap alerts. Their functions (`timeclockPlanReminders`,
`timeclockPunchReminder`, `timeclockReplanEmployee`, `timeclockReplanAll`,
`timeclockTestPush`, `timeclockVanSwapReminder`) were deleted from the project; see
*Deleting the old notification functions* below. The data they used
(`timeclock/prefs`, `timeclock/push_tokens`, `timeclock/push_tests`,
`timeclock/reminders_sent`, `timeclock/swap_reminders_sent`) is no longer read, and can
be deleted in the Firebase console. Their entries in the database rules are harmless
and were left as they are, so the rules didn't need publishing again.

### Deploying (once, and again whenever `functions/` changes)

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
`pollNow` in the same project are left alone. If the CLI asks whether to delete any
function **not** listed under *Deleting the old notification functions*, answer **No**.

### Deleting the old notification functions (once, October 2026)

In Cloud Shell, from the `timeclock` folder, after pulling the latest code
(`git pull`, then `cd functions && npm install && cd ..`):

```sh
npx firebase-tools functions:delete timeclockPlanReminders timeclockPunchReminder timeclockReplanEmployee timeclockReplanAll timeclockTestPush timeclockVanSwapReminder --region us-central1 --project eandccourier-36fcc
```

Answer **y** when it asks. Then deploy as above, so `timeclockVanTaken` gets its new
code.

### Running cost

`timeclockVanTaken` runs once per vehicle swap, and `timeclockBeforeUserCreated` once
per new sign-in. Each has 1 vCPU and 256 MiB of memory. A few runs a day fit well
inside the free allowance of [Cloud Run](https://cloud.google.com/run/pricing) (180,000
vCPU-seconds and 2 million requests a month per billing account). There is no Cloud
Scheduler job or Cloud Tasks timer any more. To see the real numbers, check Google Cloud
console → **Billing → Reports**, filtered by service.

## Failed and refused sign-ins

Both pages report sign-ins that didn't get through to the E&C security log (the
Security section of the usage page), because Firebase runs no server code when a
password is wrong:

- a wrong password, unknown email, disabled account or too many tries (the Firebase
  error code is sent, never the password);
- an email that isn't an admin typed into the admin panel's sign-in;
- a signed-in account turned away: not on the time clock, turned off, or not an admin
  (admin panel). It's sent with the account's sign-in token so the server can check who
  it really was.

The reports go to the `auditSignInReport` function in the usage repo. Until that is
deployed they fail quietly, and nothing about signing in changes either way.

## Only admins can make @ec.com sign-ins

@ec.com addresses aren't real inboxes, so nobody can prove they own one by email.
Without a check on the server, anyone could create one through the Request Pickup
sign-up page or by calling Firebase directly with the public web key.

`timeclockBeforeUserCreated` (`functions/signups.js`) runs inside Firebase
Authentication before any new account is saved. A new @ec.com account goes through
only if:

- an admin already added that exact email under **Employees** (and didn't remove it), and
- the admin panel is making that sign-in right now. Just before it creates a sign-in, the
  admin panel saves a go-ahead at `timeclock/signup_ok/<email key>` (only admins can
  write there). It works once and only for 15 minutes; when it's used, the server marks
  it with the time and the new account's id. Go-aheads are kept, never deleted.

The admin emails get no exception: the database rules make anyone signed in as one an
admin, so if an admin's sign-in is ever deleted, another admin adds that email under
**Employees** before it is made again.

Every other @ec.com sign-up is refused with *"This email can only be added by an E&C
admin."* and logged as *"Refused a new @ec.com sign-in"* with the reason (not on the time
clock, not created from the admin panel, go-ahead already used, or go-ahead expired). Customer addresses aren't
affected, and accounts that already exist keep working.

Every new account, allowed or refused, is also saved to the E&C security log
(`security_log/events`, type `signup`) with its email, sign-in method, IP address and
browser, for the Security section of the usage page. If the log can't be saved the
sign-up goes ahead as normal and the entry is written to the functions log instead.

**Adding someone works as before.** **Add employee** saves their record first and then
creates the sign-in, so the check lets it through. Staff who aren't on the time clock
need to be added under **Employees** before their sign-in is made.

An employee record with no sign-in yet (added without a starting password) can't be
claimed by someone else signing up with that email (before November 2026 it could). To
make that person's sign-in later, remove them and add them back with a starting password
(their punches stay).

### Turning it on

1. **Upgrade to Identity Platform.** Firebase only runs this kind of function ("blocking
   function") on projects upgraded to *Firebase Authentication with Identity Platform*:
   Firebase console → **Authentication** → **Settings** → upgrade. Check the pricing on
   <https://cloud.google.com/identity-platform/pricing> first.
2. **Deploy the functions** the same way as above:
   `npx firebase-tools deploy --only functions:timeclock --project eandccourier-36fcc`
3. **Check it's registered:** Firebase console → **Authentication** → **Settings** →
   *Blocking functions* should list `timeclockBeforeUserCreated` before account creation.
4. **Test it** from Cloud Shell. This makes a direct sign-up call, the same way someone
   skipping the apps would:

   ```sh
   curl -s "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=AIzaSyAKmgoXA4m3cRTmxJq4aUyva5SVvFbTNqg" \
     -H "Content-Type: application/json" \
     -d '{"email":"blocktest@ec.com","password":"blocktest123","returnSecureToken":true}'
   ```

   It should answer with an error that mentions *"This email can only be added by an E&C
   admin."* If it returns an `idToken` instead, the check isn't running: delete
   `blocktest@ec.com` under **Authentication → Users** and go back to step 3.

The function must answer within 7 seconds, or Firebase fails the sign-up. It reads one
database record, so it normally takes well under a second.
