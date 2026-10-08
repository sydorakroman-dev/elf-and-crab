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
- **No weapons in the model** (see §3). The hero holds whatever weapon is equipped; the game
  attaches it to the right wrist `wrR`.

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

## 3. Weapons

Weapons are **items**, not part of the hero: the player equips a one-handed blade, a two-handed
weapon, a bow or a staff, and that decides how the hero attacks. So:

- **Don't model a weapon** (or a shield) into the hero. Any node named `Axe…`, `Sword…`, `Bow…`,
  `Staff…`, `Shield…`, `Weapon…`, `Mace…`, `Hammer…` or `Spear…` is deleted by the prepare script.
  Belts, scabbards, quivers and the like are fine as long as nothing sticks out of the hand.
- The **right hand is a gripping fist**: the game puts the weapon's grip at the `wrR` bone's
  origin, so place `wrR` in the middle of the closed fist.
- The weapon is fixed so it points straight **up (+Y)** in the model's **rest pose** (the
  pose the nodes have with no clip playing), whatever way `wrR` itself is turned; the clips then
  turn the wrist and the weapon turns with it. So pose the rest pose's fist as if holding a pole
  upright, and animate each attack clip with that in mind.
- Weapons are about **1.9 m** long for a two-hander or staff, about **1.2 m** for a sword. Leave
  room in the clips: a two-handed chop shouldn't drive the weapon through the head or legs.

## 4. Animation clips

Animate the bones' **rotations** (and the pelvis's position if you need a bob or a crouch).
Clip names must match **exactly**:

| Clip | Needed | Loops | Length | What it is |
| --- | --- | --- | --- | --- |
| `Idle` | **required** | yes | 2–4 s | standing, breathing, weapon hand ready (fist closed) |
| `Walk` | **required** | yes | ~1.1 s | a normal walk at about **2.6 m/s**, moving in place (no root motion) |
| `Run` | **required** | yes | ~0.75 s | a run at about **7 m/s**, in place |
| `Attack1H` | **required*** | no | 0.6–1.8 s | a one-handed cut (sword, axe); also used with no weapon |
| `Attack2H` | recommended | no | 0.6–1.8 s | a big two-handed chop or swing (greataxe, greatsword, hammer); the left hand joins the grip |
| `AttackBow` | recommended | no | 0.6–1.8 s | drawing and loosing a bow (bow in the right hand, left hand draws) |
| `AttackStaff` | recommended | no | 0.6–1.8 s | a staff thrust / cast, staff pointed forward |
| `Skill` | recommended | no | 1–2.5 s | a flourish for the hero's big skill (a roar, a raised staff) — also used as the victory pose if there's no `Victory` |
| `Hit` | recommended | no | ~0.35 s | flinching from a blow |
| `Death` | recommended | no | ~1 s | falling down, **ends lying on the ground** (the last frame is held) |
| `Victory` | optional | yes | 2–3 s | celebrating |
| `Jump` | optional | no | ~1.5 s | a leap |

\* **At least one attack clip is required**; make all four if you can, since any hero can pick up
any weapon type. For all attack clips: the hit lands about **40% in**, and the game squeezes the
clip to 0.75 s. When a weapon type has no clip of its own, the game plays any other attack clip.

Missing optional clips are filled in by the game (a body tilt for `Hit`, a sideways fall for
`Death`). These other names are accepted and renamed: `Attack`, `Slash` → `Attack1H`;
`AxeCleave`, `Cleave` → `Attack2H`; `Cast` → `AttackStaff`; `BattleRoar`, `Roar` → `Skill`.

Each hero has a **preferred** weapon type that it starts the run with (and deals +15% damage
with), so that one's attack clip matters most:

| Hero | Preferred weapon | Clip |
| --- | --- | --- |
| `elf` | bow | `AttackBow` |
| `knight` | one-handed | `Attack1H` |
| `mage` | staff | `AttackStaff` |
| `barbarian` | two-handed | `Attack2H` |
| `beastmaster` | two-handed (melee) | `Attack2H` |

**In-place motion only:** the game moves the character; a clip must not travel. Loops must
start and end on the same pose.

## 5. Style

Match the hero art and the game's look: chunky, readable shapes, bold flat colours, a strong
silhouette that reads from a camera about 15 m away. Avoid hair-thin strands and very thin
parts (under ~2 cm): they get lost or turn into black outline noise.

## 6. Check before sending

- [ ] `.glb`, Y up, faces +Z, feet at y = 0, about 2 m tall
- [ ] the 17 bones above, named exactly, parts parented to them, no skin
- [ ] **no weapon or shield** in the model; the right hand is a fist with `wrR` at its centre
- [ ] `Idle`, `Walk`, `Run` and at least one attack clip (`Attack1H` / `Attack2H` / `AttackBow` /
  `AttackStaff`, ideally all four, the hero's preferred one first) — plus `Skill`, `Hit`, `Death` if possible
- [ ] clips in place (no root motion), loops seamless
- [ ] flat colours, no textures, ≤ 60k triangles

Then: `node scripts/models/prepare-hero.mjs model.glb <hero>` — it prints any missing bones or
clips, lists any weapon it removed, and prints the triangle and draw-call count.
