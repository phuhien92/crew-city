# Map and landscaping

How the city is laid out, how it grows, and how it looks. Numbers are starting values, to be tuned once the city is on screen (step 4).

Related: [visual-style.md](visual-style.md) for characters and colors, [architecture.md](architecture.md) for the data sources.

## 1. Grid and sizes

| Unit | Size |
| --- | --- |
| Tile | 1 world unit |
| Lot | 3 × 3 tiles: a 2 × 2 building footprint plus a sidewalk ring |
| District block | 4 × 3 lots (12 × 9 tiles), plus a 1-tile sidewalk edge |
| Road | 2 tiles wide between blocks, dashed center line, crosswalks at intersections |

The city sits on a finite board with clean edges, with water along the south side.

## 2. District placement

- Blocks have grid addresses. City Hall is at (0, 0).
- Reserved slots:
  - Bus station: south of City Hall
  - Harbor: on the waterfront
  - Scout labs: beside City Hall
- Code project districts fill the west and north. COWORK OS HQ districts fill the east.
- Within each side, a new district takes the next free slot in a ring around the center.
- A placed district never moves.
- Placements are saved in `layout.json` in the app's data folder, mapping each district name to its slot. A name not in the file gets the next free slot. The ledger alone can't produce a stable layout because HQs don't come from it.

## 3. Lots inside a district

- Tasks take lots in dispatch order, starting from the road-facing row.
- Scout tasks don't take lots. They work at a desk in the scout labs, with a signpost pointing to their project's district.
- A full district annexes the neighboring free slot. With no free neighbor, it consolidates (section 4).

## 4. Buildings

| Ledger outcome | Lot shows |
| --- | --- |
| `task.dispatched` | Dirt lot, fences and cones go up |
| `task.status` working | Scaffolding |
| `task.status` failed | Fire |
| `task.pr_ready` | Scaffolding coming down, inspection |
| `task.merged` | Finished building |
| `task.cleaned_up` without `task.merged` | Rubble, fading after one day; then dirt |

- Finished building style (office, shop, apartment) comes from a hash of the task ID, tinted in the district's color.
- Building height is fixed. The ledger has no PR size.
- Consolidation: past 12 finished buildings in a district, the 4 oldest merge into one tower with a floor for each.

## 5. Civic places

| Place | Shows |
| --- | --- |
| City Hall | The first mate outside; a banner with the number of decisions waiting |
| Bus station | Arrivals board (dispatches) and departures board (cleanups) |
| Scout labs | One lit desk per active scout |
| Harbor | One berth per second mate; the boat is docked while it is connected |
| HQ houses | One per COWORK OS HQ; a door sign with its active task count from `MEMORY.md` (read-only) |
| Parks and plazas | Fill unused slots |

## 6. Landscaping

- Grass ground, sidewalks around every block, water with an animated ripple on the south edge.
- Trees: three kinds (round, cone, bush). Placement comes from a hash of the tile coordinate, so it never reshuffles. Dense in parks, sparse on sidewalks, never on lots or roads.
- Props: benches and lampposts throughout. Fences and cones only around construction lots, so they also mark active work.
- No weather tied to fleet state. Fires and alerts already show problems, and mood weather is easy to misread.

## 7. Time and light

- The sun follows the local clock: daylight roughly 07:00 to 18:00, with dawn and dusk transitions.
- At night, windows and lampposts light up.
- Setting: "always day".
- One directional light with soft shadows; shadows off on low-power machines.

## 8. Camera and detail levels

- Isometric orthographic camera, rotating in 90° steps.

| Zoom | Shows |
| --- | --- |
| City | Blocks, district names, agent markers |
| District | Adds name tags and walking animation |
| Lot | Adds speech bubbles and the activity line |

- Clicking a district or worker moves the camera there and selects it in the control panel, and the reverse.
- Characters far from the camera stop animating.

## 9. Performance

- Trees, lots, and props are instanced. Each district's ground and roads merge into a few meshes.
- Target, not yet measured: 60 fps with about 20 agents and 300 buildings on a laptop.

## 10. Data this needs

| Data | Source | Status |
| --- | --- | --- |
| Task lifecycle | Firstmate ledger | Done (step 1) |
| District placement | `layout.json` | New |
| HQ list and active task counts | Vault reader | Step 3 |
| Local time | OS | Available |
| PR size, for building height | GitHub | Not planned; open question |
