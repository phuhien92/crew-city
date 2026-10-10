# Visual style

The look of the city and its characters. Colors here will move into the shared design tokens file when step 4 starts, so the panel, the roster, and the 3D scene use the same values.

## Characters: blocky people

Decided October 2026. Chosen over two other concepts: round toy figures and wooden peg dolls.

Characters are original. They are not modeled on any toy brand's figure.

### Build

- Made in code from boxes in react-three-fiber. No imported model files, so no asset licenses.
- About ten boxes per character: head, eyes, torso, two arms, two hands, two legs, two shoes, plus hat and prop.
- Flat colors. If a large fleet gets slow, repeated parts can be instanced.
- Upgrade path, if ever wanted: rigged CC0 low-poly characters can replace the boxes without changing the data mapping below.

### Proportions (concept units; one character is about 100 units tall without a hat)

| Part | Size (w × h) | Position (top-left, relative to head top-center) |
| --- | --- | --- |
| Head | 28 × 26 | (-14, 0) |
| Eyes | 4 × 4 each | (-8, 10) and (4, 10) |
| Torso | 36 × 38 | (-18, 28) |
| Arms | 8 × 30 each | (-26, 30) and (18, 30) |
| Hands | 8 × 7 each | below each arm |
| Legs | 12 × 30 each | (-14, 66) and (2, 66) |
| Shoes | 14 × 6 each | (-15, 94) and (1, 94) |

### Role: outfit and hat

Role comes from firstmate data: the first mate is the primary session; crewmates use the task's `kind` from `task.dispatched`.

| Role | Torso and arms | Legs | Hat | Prop |
| --- | --- | --- | --- | --- |
| First mate | Navy coat `#0C447C`, gold buttons `#FAC775` | `#042C53` | Captain's hat: white crown `#F1EFE8`, black brim `#2C2C2A`, gold badge `#EF9F27` | none |
| Ship crew (`ship`) | Orange vest `#D85A30`, reflective stripe `#FAC775` | `#444441` | Hard hat `#EF9F27`, brim `#BA7517` | Hammer |
| Scout (`scout`) | White lab coat `#F1EFE8`, teal shirt `#1D9E75` | `#5F5E5A` | Dark hair `#2C2C2A`, round glasses | Magnifier |
| Second mate (`secondmate`) | Purple jacket `#534AB7` | `#26215C` | Cap `#7F77DD`, visor `#3C3489` | Briefcase |

### Variation

- Skin tone, hair, and shoe color are picked from a hash of the task ID, so a task always gets the same person and neighbors don't look identical.
- Concept skin tones: `#F5C4B3`, `#E0B08A`, `#C58C5C`, `#8D5A3B`.

### State: bubble, pose, animation

Bubbles float above the head and always face the camera (drei `Billboard`). Bubble colors are the phase colors and must match the panel badges.

| Phase | Bubble | Pose and animation |
| --- | --- | --- |
| dispatched | none | Walks from the bus stop to the lot |
| working | Blue `#378ADD`, three dots | Hammer swing (ship), magnifier sweep (scout) |
| needs-decision | Amber `#EF9F27`, `?` | One arm raised, waiting |
| blocked, paused | Amber, `…` | Standing still |
| failed | Red `#E24B4A`, `!` | Standing by the fire on the lot |
| done | none | Idle at the lot |
| pr-ready | Green `#639922`, check mark | Holding a clipboard |
| merged | none | Small jump, then idle |
| cleaned up | none | Walks to the bus stop and leaves |

Base motion for every character: a slight idle bob, and a walk cycle with swinging arms and legs.

### Name tag

Above each head: the task ID with a status dot in the phase color.

### Rules

- No brand logos for agent tools (Claude, Codex, and others). If the harness needs showing, use a small colored badge.
- Role must be readable from silhouette alone when zoomed out.
