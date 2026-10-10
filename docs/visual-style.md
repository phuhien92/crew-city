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

### Agent marker: floating block

Every agent has a small floating block above its head. NPCs never have one, so the number of blocks is the number of real agents.

- Shape: an isometric cube, the same block language as the logo. Chosen over a traffic cone, hex nut, and pennant. A floating diamond was ruled out because it is too close to another game's trademark symbol.
- Color: the phase color, using three shades of one ramp for the top, left, and right faces.

| Phase | Top | Left | Right |
| --- | --- | --- | --- |
| working, dispatched | `#85B7EB` | `#378ADD` | `#185FA5` |
| needs-decision, blocked, paused | `#FAC775` | `#EF9F27` | `#BA7517` |
| failed | `#F09595` | `#E24B4A` | `#A32D2D` |
| pr-ready, merged | `#97C459` | `#639922` | `#3B6D11` |
| idle, done | `#D3D1C7` | `#B4B2A9` | `#888780` |

- First mate: navy block (`#185FA5`, `#0C447C`, `#042C53`) with a gold edge (`#FAC775`); it turns amber while the first mate has decisions waiting.
- Constant screen size: the block keeps its on-screen size when zoomed out, so a far view of the city still shows where work and problems are. Name tags and bubbles appear only when zoomed in.
- Placement, top to bottom: block, then name tag, then hat and head. Speech bubbles sit beside the block, never over it.
- Motion: slow spin and bob while working, a pulse when the agent needs you, none when the OS reduced-motion setting is on.

### Cast variety

Agents can be kids, seniors, women, men, or animals (dogs, cats, and more later).

- Role comes only from hat and outfit, never from body type, age, gender, or species. Any body can hold any role.
- Body type is picked from a hash of the task ID, together with skin tone, hair, and shoes, so a task always gets the same character.
- Body types (concept):
  - Kid: shorter torso, arms, and legs (torso 26, arms 20, legs 18 units); same head size.
  - Senior: gray hair, glasses or mustache, optional cane.
  - Woman and man: varied hair, including long hair and beards.
  - Dog: floppy ears, snout and nose, paws in fur color.
  - Cat: pointed ears, whiskers, paws in fur color.
- The marker block sits at the same height above every head, so a kid's block doesn't hide among taller characters.
- A setting may limit the mix (people only, or mixed with animals).

### NPCs

NPCs make the city feel alive but must never be mistaken for agents.

- Plain clothes in muted colors, no role hats or outfits, no marker block, no name tag, no bubbles.
- Not selectable; only agents open a card in the panel.
- Keep to roads and sidewalks; never stand on lots or cover bubbles; fade when zoomed in on a task.
- Capped in number; an "ambient life" setting turns them off; still when reduced motion is on.
- Planned kinds, in build order:
  1. Residents: one per merged building, so population is visible.
  2. Foot traffic scaled to how many agents are working; quiet when the crew is idle.
  3. Event characters tied to phases: firefighter at a failed lot, inspector at a pr-ready lot, delivery van at dispatch.
  4. A few decorative animals, such as pigeons near City Hall.
- Built after the core city in step 4.

### Name tag

Above each head: the task ID with a status dot in the phase color.

### Rules

- No brand logos for agent tools (Claude, Codex, and others). If the harness needs showing, use a small colored badge.
- Role must be readable from silhouette alone when zoomed out.

## Logo

Three isometric block towers (navy, orange, teal); the tallest, orange tower wears an amber hard hat, so the mark reads as both the city and the crew.

| File | Use |
| --- | --- |
| [`assets/brand/mark.svg`](../assets/brand/mark.svg) | The mark on its own: README, favicon, in-app header |
| [`assets/brand/icon.svg`](../assets/brand/icon.svg) | App icon: the mark on a rounded light-blue tile (`#B5D4F4`), 512 × 512 |

- Wordmark: "Crew City" in Bricolage Grotesque 700, with "City" in orange (`#D85A30` on light, `#F0997B` on dark).
- Tagline: "Your agent crew, as a city".
- The mark keeps its colors on light and dark backgrounds; only the wordmark color changes.
