// Google Maps browser key for the admin panel: the map in each punch's location window, and the
// street address looked up (once) for each punch location. It's the same key RouteWatcher uses
// (RouteWatcher/index.html), restricted in Google Cloud console to the E&C website, so it's safe in
// page code. It needs the Maps JavaScript API and Geocoding API allowed, which it already has.
// Left empty, the admin panel shows each punch's coordinates with an "Open in Google Maps" link instead.
export const MAPS_KEY = "AIzaSyA6umETP8wBUEV41ugAtiNiChUeLmmwmZI";
