# Ever Outward: The Next Gate

A local owner workspace and a public National Trust journal. The next five places are ordered by **saved driving distance from the current home**. Each home has its own discovery circle, using shared visit progress: a filled, semi-transparent circle reaches the outermost visited place geographically inside that home's next unvisited destination. Visits farther away do not enlarge that local challenge range. The circle can be confirmed even while the next-five order is provisional: it appears when every possible next destination gives the same visited extent. A missing distance holds up the circle only if it could change that extent. When all places are visited, the circle reaches the farthest visit.

## Run locally

Use Node.js 24 or newer.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The local server opens with full owner access automatically: no password or sign-in is needed, including if you previously created an owner password. Access to the local server is the editing boundary. The first journey is already configured privately on this computer from the supplied postcode; a fresh checkout asks you to set home in Workspace. The owner API listens only on `127.0.0.1:3001`. The published journal remains read-only apart from guest comments.

For a production build served locally, run `npm run build` and `npm start`, then open http://127.0.0.1:3001. Use an HTTP URL in T3's browser preview, rather than its HTML-file preview.

## Use the journal

- Record a visit with a date, the people who came along, summary, full story, optional star rating and up to 200 photos or collection links (display copies combined: 8 MB maximum). Select any display photo to open the full visit carousel; the timeline uses the selected cover photo, falling back to the first available photo when no cover preview is available. Portrait and landscape images fit without cropping. The visit header shows a rotating photo wheel with blurred adjacent previews, a compact 1–20 second interval selector (10 seconds by default), pause/play, previous/next, mouse drag, touch swipe and horizontal trackpad scrolling. The interval is remembered in browser local storage for this site, across visits and reloads, without an account or cookie. It does not sync between browsers/devices or the local and published sites; blocked storage keeps the choice only for the current session. Manual gestures pause playback. Reduced-motion visitors start paused; single-photo visits show a still image.
- The timeline includes separate entries for repeat visits, ordered newest first. Enter attendee names separated by commas; they appear on cards and full visit details, and can be found with timeline search. It reveals 20 entries at a time and opens full visit details in the main map area. Back restores the timeline position.
- New visits have **Include in the public journal when published** selected by default. Saving is local until you press **Workspace → Publish journal to here.now**. Uncheck this option to keep a visit private. Workspace also lists every visit under **Choose visits to publish**, with included/excluded totals. Existing excluded visits are not automatically opted in.
- Visit labels distinguish **Only on this computer** (excluded), **Ready to publish** (selected but not live), **Published** (matches the last successful publication), **Changes not yet published**, and **Removal pending publish** (currently live but now excluded). Unchecking a public visit removes it on the next publish, not immediately.
- Guest comments require a name and text, appear immediately, and belong either to the visit or an individual photo. Remove public comments from that visit in the local owner workspace.
- Light, Dark and System themes persist in the browser. The original kissing-gate artwork and its favicon, Apple, app and maskable exports are in `public/icons`.

## The next five by driving distance

### Home locations and trip origins

Use **Workspace → Home locations → Add home location** to give a home a name and colour. Find its postcode, click or drag the map pin, or enter coordinates. **Make current** chooses the single home used for the next five, driving distances and new trip defaults. The **Starting from** selector switches homes quickly. On the public website, this selector changes only that visitor's view.

Every available home has a labelled centre on the map. Its discovery circle appears when its visited extent is confirmed and there are qualifying visits; the next-five route order may still be provisional. The current circle has a thick solid outline and stronger fill; other homes use thin dashed outlines. **Show all home locations** frames them together. Visits count towards every home's progress, regardless of which home a trip started from. Circles update automatically from saved visits and distances. Public circles are checked again around their rounded centres.

The visit editor's **Started from** field defaults to the current home when opened and can be changed to another home. Each saved visit keeps a private snapshot of its starting home's position. The displayed name follows the home's current name, so renaming **CB3 0LL** to **Girton** updates existing visit labels locally and on the next publish. Moving, switching or removing a home does not change recorded trip coordinates. To correct a trip, edit its starting-home selection. Removing a home archives it and its distances; its last name remains available for existing visit labels. Removing the current home requires choosing its replacement, and the final home cannot be removed.

The one-time multiple-home migration creates a private SQLite backup in `.local/backups/before-multiple-homes-*.sqlite`, gives the existing home a stable ID, and assigns every existing visit (including drafts) to it. On this journal that home is **CB3 0LL**. Notes, photos, selected covers, dates and saved distances are preserved. Migration is transactional and does not repeat or overwrite later origin corrections.

### Linked photos and drag-and-drop

The visit editor opens Google Photos, iCloud Photos, Google Drive, OneDrive, Dropbox and Flickr in a new tab. Copy a shared HTTPS photo or album link, then paste it into **Add photo link** or drop it into the photo drop area. **Load preview** checks for an image exposed by the provider's public share page. Dropbox image links use its documented `raw=1` rendering option. Preview fetching is owner-only, bounded and restricted to recognised provider hosts, including redirects.

A share page is not always an embeddable image. Google/iCloud links may provide no preview, require sign-in, or expire; no private-account access or automatic album synchronisation is implied. In that case, choose a display image from your device, drop one onto the existing link, or supply a direct image URL. The original shared link stays attached, opens from visit details, and the selected display image can be the cover. For Google Photos, use **Add from a Google Photos album** → **Paste link** → **Load album**, review the thumbnail selection, then **Add selected photos**. Each selected photo can be removed or chosen as the cover independently; Google originals remain unchanged. Re-importing skips photos already attached. Import reads the photos exposed on the public share page (up to 200); large albums may expose only part of their contents, and future changes are not synced. Other provider albums remain linked collections. Every link field includes a **Paste link** button; if clipboard access is blocked, it focuses the field and explains keyboard or touch paste. [Google Photos sharing](https://support.google.com/photos/answer/6131416), [Apple Shared Albums](https://support.apple.com/en-ie/108314), [iCloud Link expiry](https://support.apple.com/en-ca/guide/icloud/mm93a9b98683/icloud), [Dropbox image rendering](https://help.dropbox.com/share/force-download).

You can also drop multiple JPEG, PNG or WebP files into the drop area, or use its file picker. The app stores resized JPEG display copies (up to 1,400 pixels and 750 KB encoded per image) in the visit record, so they survive deployment. Original image files stay on your device/provider. Only published visits and their display copies are exported publicly; drafts remain local.

### Visit order

The homepage leads with the nearest unvisited destination, five numbered photo cards and a map framed around those places. Search is available behind the small **Find a place** button and never changes the challenge order.

Driving estimates come from the free [FOSSGIS OSRM car service](https://routing.openstreetmap.de/about.html); [Waze](https://developers.google.com/waze/deeplinks) remains the directions link. Distances describe OSRM's recommended fastest car routes, sorted by road length, rather than a shortest-distance routing mode. Times exclude live traffic. No account, API key or paid usage is enabled.

Use **Workspace → Home locations → Calculate all distances for [home]** once for each home. The app calculates and saves distance and travel time for the entire catalogue, including places already visited. Results stay in `.local/everoutward.sqlite` keyed by stable home ID, coordinate version and place ID, with their source and calculation date; they do not expire. Moving one home requires fresh distances for that home only. Changing its name or colour keeps its distances. Recording visits and publishing reuse these saved distances without calling the routing service. Publishing does not recalculate routes.

Requests identify the app, are spaced at least 1.1 seconds apart and process 25 destinations per batch. Your starting coordinates are sent to FOSSGIS for calculation. Its community service has no availability guarantee. Each successful batch is saved immediately, so an interrupted run can resume without repeating saved work. Places with no car route are reported for review. A gap over 1 km between the routed road and the destination now adds a separate, clearly labelled walking estimate: the straight-line gap at an assumed 4 km/h, one way. This is not a verified footpath or terrain-aware walking route. Driving miles and time stay separate, with combined estimates shown in place details; the next five remain ordered by driving distance. Known boat crossings are kept for departure-point review instead of being labelled as walks. Missing nearby routes keep the next-five queue provisional. Check the actual visitor entrance in Waze before travelling.

### Review and resolve distances

Use **Workspace → Review driving distances**. Choose a home without changing the current home, filter by **Needs review**, **Missing distances**, **Resolved reviews** or **All distances**, or search for any place. Home cards also link directly to their failed routes.

- **Save a verified distance** replaces that home's driving miles and minutes, with a public source and private evidence notes.
- **Correct the entrance for all homes** saves a verified road entrance or departure point, its source URL and a public access note. Waze and calculations use it; the original catalogue marker and discovery point stay intact. Only this destination is recalculated for every home. Old entrance versions cannot silently contribute stale distances.
- **Retry this route calculation** recalculates this place for the selected home. Walks over 1 km are accepted with the estimate described above.
- **Flag this distance as unreliable** retains the old value for review but excludes it from ordering until resolved.

Saving a correction automatically queues a website publish. Corrected entrances, public access notes, walking estimates and reviewed distances are included even outside the next five. If a publish is already running, a follow-up publish is queued. Workspace shows progress or a persistent error with retry. Publishing includes all currently selected visits, as the ordinary Publish button does. Private review notes, entrance evidence URLs and exact home coordinates remain local; backups retain the review history.

Brownsea Island, Lundy and the Farne Islands show a **boat icon / Boat trip required** flag on destination cards, map popups, place details, reviews and recorded visits, locally and publicly. Their road-to-island gap is not treated as a walk. Check their departure points and transfer arrangements: [Brownsea visitor access](https://www.nationaltrust.org.uk/visit/dorset/brownsea-island/booking-your-visit-and-travelling-to-brownsea-island), [Lundy travel](https://www.landmarktrust.org.uk/lundyisland/timetable/), [Farne Islands visitor access](https://www.nationaltrust.org.uk/visit/north-east/farne-islands). Evidence-backed exceptions are maintained in `server/access-rules.mjs`.

### Agent instructions: calculate or recalculate all distances

1. Confirm the intended home in **Workspace → Home locations → Edit** and save it. Moving its coordinates invalidates its previous distances automatically; changing only the name or colour keeps them. Do not edit the SQLite home record directly or reuse its version for a changed location. Run `npm run homes:list` to find stable home IDs and saved totals.
2. From the repository root, run `npm run routes:refresh -- --home HOME_ID`, replacing `HOME_ID` with the chosen ID. Use `npm run routes:refresh -- --all-homes` to calculate every available home sequentially; without either option, the command uses the current home. Run only one calculation at a time. This works with the local app stopped or running, makes a private SQLite backup in `.local/backups/`, calculates every missing catalogue distance (including visited places), and saves the results. After a home move this means its whole catalogue. No password or API key is needed. Switching the current home does not redirect an in-progress job; moving or removing the job's home stops it.
3. Read the command summary and `.local/route-reports/HOME_ID.json`. `saved` / `total` and `remaining` describe that home's whole catalogue; `nextFiveConfirmed` in the console only describes its next-five ordering. Review `unavailablePlaces` for destinations needing an entrance or road-access check. Do not treat an unreachable destination as zero miles, and do not guess a distance. A service error stops the run but preserves completed batches; rerun the same command to finish.
4. Refresh the local app to see each home's saved totals and updated next five. Changed routes automatically queue a website publish, including completed batches if a later request fails. Check Workspace for completion or retry an error. Keep plans local.

To deliberately replace **all** saved distances for the same home (for example after road or catalogue-coordinate changes), run `npm run routes:refresh -- --home HOME_ID --force`. Combine `--all-homes --force` to refresh them all. This also replaces manually entered distances when a new valid route is returned. Failed lookups retain the previous value for review but exclude it from ordering until resolved; the report identifies those failures. Regular runs reuse saved distances regardless of age. Keep reports, backups and the database private and out of Git.

For an exceptional destination, use the review workflow above; **Save Waze distance** on place details remains a shortcut and also queues publication. An agent can also submit verified distances with `PUT /api/routes`, `Content-Type: application/json`, `Origin: http://127.0.0.1:5173` and `X-EverOutward: 1`, using this request body (metres and seconds):

```json
{"homeId":"ID from npm run homes:list","homeVersion":"version from npm run homes:list","routes":[{"placeId":"ID from public/data/places.json","metres":12000,"seconds":900}]}
```

The current five destinations have locally hosted Wikimedia Commons photographs with individual source, photographer and licence links. Descriptions and access notes link to the National Trust's official pages. Source metadata is maintained in `scripts/place-details.json`. Remaining catalogue destinations still need this enrichment as the journey expands.

## Publish and pin

Public site: https://quartz-oyster-7zxz.here.now/

It is a **new permanent site in the connected personal here.now account**. Subsequent publishes reuse it and check for changes made elsewhere before overwriting.

```powershell
npm run deploy
```

The command reads `HERENOW_API_KEY` or the existing `~/.herenow/credentials`. The browser never receives that key. Only the contents of the generated `dist` directory are uploaded, excluding source maps. Deployment state stays in the ignored `.herenow/state.json`.

The browser button and `npm run deploy` share one persistent publishing job. The button starts a background process and shows backup/build/upload/finalisation progress, then a lasting success or error message beside the button. Reloading, navigating away or restarting the local API does not stop the worker; opening Workspace reconnects to its status. Repeated clicks join the running job. If it fails, the cause remains visible and you can retry. If the finalisation response is lost, the publisher checks whether that exact upload is already live before treating it as a failure. Optional comment-upload failures are reported separately after a successful website publication. Development watches only the `server` directory, avoiding dependency-watch restarts during publication.

**Dashboard pinning remains a manual step:** sign in at [here.now](https://here.now/dashboard), find **Ever Outward: The Next Gate**, and choose **Pin to top**. The dashboard pin endpoint rejects API-key authentication. Permanent hosting is already active and does not depend on the pin.

## Data and privacy

The official [National Trust Visitor Properties layer](https://services-eu1.arcgis.com/NPIbx47lsIiu2pqz/ArcGIS/rest/services/National_Trust_Visitor_Properties_/FeatureServer/0) supplied 643 records. National Trust for Scotland is excluded. Source credit: National Trust, SMU, GIS Product Team, 2024; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Coordinates are converted to WGS84 and records normalised. This is an independent family project, not an official National Trust service.

Run `npm run catalogue:import` to refresh the source. Stable GlobalIDs preserve visit associations. Reviewed descriptions and official links for the initial nearby places live in `scripts/place-details.json`. Source points are not verified visitor entrances. Most records do not include licensed photos, descriptions or opening schedules; the app shows clear fallbacks and links to official information. No “open now” status or route estimate is fabricated.

The fallback overview map uses bundled [Natural Earth public-domain outlines and settlement labels](https://www.naturalearthdata.com/about/terms-of-use/), so it has no third-party tile dependency. Street detail is the default and uses [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) with visible attribution, normal caching, and an explicit image referrer policy. The overview remains available if that service blocks requests. The overview does not show street-level roads. There is no tile prefetch or offline tile download. Photo URLs are loaded from their external hosts; an album URL remains a link.

Exact home coordinates, private trip-origin snapshots, exact home-centred circles, drafts, passwords and full route records remain local. The public snapshot includes selected visits with their recorded starting-home **name**, each available home's name and colour, its saved next-five queue, reviewed route values and public sources, additional walking estimates/notes, corrected destination entrances and an **approximate discovery circle**. Each centre is rounded to a 0.1° grid and its radius is recomputed from that approximate centre using published visits, never copied from the private circle. Choose friendly names if you do not want an address or postcode shared. Archived homes are omitted from the map, while their historical trip names remain. Public route distances can still give an approximate indication of the starting area. SQLite data and credentials are excluded from Git and publishing.

**Persistence:** The authoritative local journal is `.local/everoutward.sqlite`, separate from source code and `dist`. A website build does not seed, reset or replace this database. Publishing takes a consistent database snapshot and publishes only selected visits. Guest comments remain in the same here.now Site Data collection across deployments.

**Automatic backup:** Every deployment first creates a consistent full SQLite backup in `.local/backups/` using SQLite's snapshot operation, including notes, photo links, uploaded display copies, drafts, local settings and local comments. Backups are never published. If the database is missing, deployment stops. If notes, visits, home, routes or distance reviews change during upload, deployment stops before finalisation; if edits arrive during the final network request, they remain local and the app reports that another publish is needed. Public comments are separate and are not included in these database backups.

**Keep an off-computer backup:** Workspace exports local visits, display photos, links, local comments, home and routes as private JSON. For full recovery, keep a copy of `.local` and `.herenow/state.json` on another device or private backup service. Automatic backups on the same disk do not protect against loss of that disk. To restore a SQLite backup, stop the local server and replace the database using a verified backup, keeping the previous database and its WAL/SHM files together elsewhere before restarting. Cloud-synchronised owner editing is not implemented; saved local edits appear publicly after publishing.

## Current limits

- Local editing has no cross-device account or automatic cloud journal sync. Publish explicitly after journal edits; distance corrections queue publishing automatically.
- The timeline progressively renders the current complete snapshot; it is not yet a server-paginated or virtualised large archive.
- here.now enforces comment types, maximum lengths and an IP rate limit. The app rejects blank names/text and hides malformed empty submissions. The raw Site Data API accepts empty strings and cannot enforce visit/photo foreign keys. A dedicated backend is needed for stronger public submission validation, configurable spam rules and private comment storage. Previously published comments are public data; unpublishing a visit hides its thread in this app but does not erase those public records.
- The catalogue needs entrance, duplicate-destination and eligibility review before the challenge can claim an authoritative nationwide driving order.

## Checks

```powershell
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

Tests cover road order versus geographic order, repeat/deleted visits, home changes, draft privacy, owner access, comment validation, edit conflicts, 45-entry timeline scrolling, back navigation, separate photo comments, browser editing, theme persistence and mobile overflow. Browser fixtures use an isolated in-memory database and never modify the real journal. Regenerate icons with `npm run icons`.

The original reviewable plan is [ever-outward-plan.html](ever-outward-plan.html). Its here.now section records the confirmed first-release architecture and distinguishes later enhancements.
