# Hero model spec — Elf & Crab

Instructions for whoever (or whatever AI) makes a playable hero model. A model that follows them
drops straight into the game: `node scripts/models/prepare-hero.mjs <file.glb> <hero>` checks it,
slims it down and writes `public/models/heroes/<hero>.glb`, and the game uses it for that hero.

Heroes: `elf`, `knight`, `mage`, `barbarian`, `beastmaster`.

## 1. File

- **Format:** one binary glTF file (`.glb`), glTF 2.0.
- **Size:** aim for **≤ 60,000 triangles** and **≤ 15 MB**. Heavier is accepted (it gets
  simplified), but thin details may suffer.
- **Units and orientation:** 1 unit = 1 metre, **Y up**, the character **faces +Z**, standing
  on the ground at **y = 0**, centred on x = 0, z = 0. Height around **2 m** (it's scaled to
  2.05 m anyway).
- **Colours:** flat **material base colours**. **No textures** (they're dropped). Use as many
  materials as you like (one per colour); the game shades everything in its cartoon style and
  adds the black outlines itself, so don't model outlines.
- **No skinning.** The body is made of **rigid parts attached to bones**: each mesh is a child
  of the bone it moves with (forearm pieces under the elbow, the head under the head bone…).
  No skeleton/skin weights, no morph targets.
- The **weapon** is a mesh (or several) parented to the **right wrist** `wrR` (or `wrL` for a
  shield / off-hand item).

## 2. Bones

Bones are plain nodes (empties), in this hierarchy, with **exactly these names**:

```
pelvis                      (at the hips, ~0.95 m up)
├─ spine
│  └─ chest
│     ├─ neck
│     │  └─ head
│     ├─ shR → elR → wrR    (right shoulder → elbow → wrist; the weapon hand)
│     └─ shL → elL → wrL    (left shoulder → elbow → wrist)
├─ hipR → kneeR → ankleR
└─ hipL → kneeL → ankleL
```

Extra nodes (cloak, belt pouches, hair, a beard) are fine anywhere in the tree; put cloth that
should sway under its own empty so it can be animated in the clips.

## 3. Animation clips

Animate the bones' **rotations** (and the pelvis's position if you need a bob or a crouch).
Clip names must match **exactly**:

| Clip | Needed | Loops | Length | What it is |
| --- | --- | --- | --- | --- |
| `Idle` | **required** | yes | 2–4 s | standing, breathing, weapon ready |
| `Walk` | **required** | yes | ~1.1 s | a normal walk at about **2.6 m/s**, moving in place (no root motion) |
| `Run` | **required** | yes | ~0.75 s | a run at about **7 m/s**, in place |
| `Attack` | **required** | no | 0.6–1.8 s | the basic attack (a swing, a stab, a cast); the hit lands about 40% in. The game squeezes it to 0.75 s |
| `Skill` | recommended | no | 1–2.5 s | a flourish for the hero's big skill (a roar, a raised staff) — also used as the victory pose if there's no `Victory` |
| `Hit` | recommended | no | ~0.35 s | flinching from a blow |
| `Death` | recommended | no | ~1 s | falling down, **ends lying on the ground** (the last frame is held) |
| `Victory` | optional | yes | 2–3 s | celebrating |
| `Jump` | optional | no | ~1.5 s | a leap |

Missing optional clips are filled in by the game (a body tilt for `Hit`, a sideways fall for
`Death`). Old names `AxeCleave` → `Attack` and `BattleRoar` → `Skill` are also accepted.

**In-place motion only:** the game moves the character; a clip must not travel. Loops must
start and end on the same pose.

## 4. Style

Match the hero art and the game's look: chunky, readable shapes, bold flat colours, a strong
silhouette that reads from a camera about 15 m away. Avoid hair-thin strands and very thin
parts (under ~2 cm): they get lost or turn into black outline noise.

## 5. Check before sending

- [ ] `.glb`, Y up, faces +Z, feet at y = 0, about 2 m tall
- [ ] the 17 bones above, named exactly, parts parented to them, no skin
- [ ] `Idle`, `Walk`, `Run`, `Attack` present (plus `Skill`, `Hit`, `Death` if possible)
- [ ] clips in place (no root motion), loops seamless
- [ ] flat colours, no textures, ≤ 60k triangles

Then: `node scripts/models/prepare-hero.mjs model.glb <hero>` — it prints any missing bones or
clips, and the triangle and draw-call count.
