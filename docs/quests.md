# Elf & Crab — Quests

- **Version:** 0.1 · 2026-10-09
- **Status:** approved, and all three are implemented: Q01 (`src/game/fox.ts`), Q02 (`src/game/knight.ts`) and Q03 (`src/game/cages.ts`), with the rules and placement in `src/game/quests.ts`.
- **Owner:** design (written by Claude for review)
- **Method:** written to `RPG_Quest_and_Campaign_Design_Guide.md`:
  - a brief built from established canon and assumptions;
  - pitches compared before expanding (§3.4);
  - the quest template (§13);
  - the acceptance checks (§15).

In this document, **Fact** means it's in the game today, **Assumption** means I assumed it (please confirm), and **Proposal** means it's new and needs building.

---

## 1. Brief

| Input | Decision |
| --- | --- |
| Player fantasy | **Fact:** two friends fight north through a fallen realm: a hero (elf, knight, mage, barbarian or beast master) and a familiar (crab, capybara, wolf, goldfish or iguana), played on a tablet. Quests add helping the creatures and people of the realm and seeing them helped. |
| Audience, format | **Fact:** co-op, with the hero in a desktop browser and the familiar on a tablet (`?join=CODE`); solo is also supported. **Assumption:** the familiar is often played by a child. The rune riddles use single digits and sums up to 15, and the familiar UI is big tap buttons. So the guide's §16 (adult-and-child co-op) module is applied: low reading, no precise simultaneous timing, recoverable mistakes, and each player owns a visible part of every important moment. |
| Tone | Bright storybook adventure. Danger, but no gore or cruelty on screen; captives and spirits are treated kindly. Light humour is fine. |
| Core loop | **Fact:** explore a generated level north, wake and fight packs, gather gold, books and gear, beat the guardian, the familiar breaks the Rune Seal with riddles, then the merchant's camp and the next level. Levels and a skill tree grow the hero over the run. |
| Supported systems | **Fact:** movement and dash, combat, packs that sleep and wake, the orc camp's alarm, the crypt's sarcophagus ambushes, named landmarks, the minimap, chests, pickups, gold and the bag, the merchant screen, banners and toasts, the familiar's spells, Rune Seal riddles, zones, an ally entity (the treant and wolf), XP. **Not present:** NPC dialogue, a quest log, saving mid-run. |
| Scope | **Fact:** seven levels per run, generated fresh each time. Quests live inside a run: state resets each run and quests repeat on later runs, a little different each time. |
| Failure contract | **Fact:** a run ends on the hero's death, and there is no mid-run save. Quests therefore never hard-fail the run; they fail forward or close their optional arc (§8.1). |
| Production budget | Three quests, one each in the Woodland, the Crypt and the Throne Room. One shared quest system plus small per-quest entities. No voice, no cutscenes. |
| Canon used | Landmarks: *the Hollow Oak* (Woodland), *the Grave Obelisk* (Crypt), *the War Banner* (Throne Room). Bosses: the Crystal Bear, the Necromancer, the Orc Chieftain. Other canon: the merchant's camp between levels, the Ash King at the end. |

**Design pillars:**

| Pillar | Sign of success | Avoid |
| --- | --- | --- |
| **Two heroes, two jobs:** the hero and the familiar each own a part that changes the outcome | After a quest, both players can say what *they* did | Familiar tasks that are just "follow the hero" |
| **Kindness shows:** helping someone visibly changes the run | The thing you saved appears later (at the merchant, in a boss fight) | Rewards that are only a number in the bag |
| **Pick your way:** big obstacles have two or three real approaches | Players choose differently on different runs | "Choices" that converge with no difference |
| **Quick and readable:** each quest fits inside a level, explained by sights and short lines | A child can follow it from pictures and a one-line goal | Walls of text; pixel-hunting |

## 2. Campaign framing (light)

- **World situation:** the Ash King is waking under the volcano. His heat spreads south, and every level's guardian serves him or profits from the chaos. **Assumption:** this extends the existing level intros; it's not established canon.
- **Personal stake:** the hero's party is the only one moving north. Along the way, the creatures and folk of each land are in trouble the guardians made.
- **What the player can change:** inside each level, who is saved or freed and on what terms. Those choices pay off later in the same run, at a boss fight or at the merchant.

The quests are **optional regional arcs** (§2.3). The critical path stays "beat the guardian, break the seal, go north", and it must stay viable with every quest ignored.

| Quest ID | Level | Role | Prerequisites | Main action | Outputs | Fallback or bypass | Next |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Q01** The Lantern Fox | 1 · Woodland | Opening promise: teaches the two-jobs split | None (any run) | The familiar leads a lost fox kit home while the hero clears the way | `q01_status`; `fox_path_open` (a shortcut to the guardian); Lantern Charm | Solo: the kit follows the hero | Hooks Q02 (the fox kit returns on later runs, below) |
| **Q02** The Knight Who Would Not Rest | 3 · Crypt | Meaningful decision paid off at the boss | None | Free a bound knight's spirit (familiar riddles + hero guards) **or** take his blade | `q02_choice` (freed / plundered / left); Necromancer fight changes | Solo: the hero shoots the runes in order | None |
| **Q03** Cages of the War Camp | 4 · Throne Room | Approaches and world change | Hook at the merchant after level 3 (optional; can be found directly) | Free three caged captives: quietly, loudly, or by silencing the war horns first | `q03_freed` (0–3); merchant's stock and prices | Freed after the Chieftain if the camp moves them to the keep | The merchant after level 4 acknowledges it |

All three are **per run**, with no dependencies between them, so no ordering can strand a run (§2.4).

## 3. Pitches compared (§3.4)

| Pitch | Player contribution | Emotional value | Campaign link | System reuse | Cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **The Lantern Fox:** escort a lost kit home | Strong for both players: the familiar leads, the hero clears | Warmth, care | Opening promise; a shortcut | Ally entity, landmarks, pack wake rules | Low-medium | **Expand (Q01)** |
| **The Knight Who Would Not Rest:** free or plunder a bound spirit | Riddles (familiar) and defence (hero) | Respect vs temptation | Pays off at the boss | Riddles, sarcophagus ambush, ally entity | Medium | **Expand (Q02)** |
| **Cages of the War Camp:** free captives | Three approaches; the familiar unlocks | Rescue, cleverness | Merchant reacts | Alarm system, Wind Walk, decoy, familiar spells | Medium | **Expand (Q03)** |
| Ember Shards: collect a shard on every level for the Ash King fight | Mostly collection | Low | Strong | Pickups | Low | Cut: a retrieval chore without a good reason (§3.3) |
| The Drowned Bell: ring three bells in the Flooded Hall to drain water | Hero and familiar timing | Medium | Weak | Zones | High (water states) | Defer: needs dynamic water, and simultaneous timing is risky for a child (§16) |

---

## 4. Q01 · The Lantern Fox

### Purpose
- **Role in the campaign:** the opening promise, and the first time hero and familiar have *different jobs*. Linked quests: none required.
- **Pillars:** Two heroes, two jobs · Kindness shows · Quick and readable.
- **Player goal:** bring a lost fox kit back to its den under *the Hollow Oak*.
- **Emotional intention:** concern → protectiveness → warmth when the fox family's tails light the den.
- **Central tension:** the kit is terrified of fighting. Awake monsters near it make it bolt and hide, so the path must be made safe while it's led.
- **Player contribution:** the **familiar** coaxes the kit and leads it, walking where it walks. The **hero** scouts ahead and clears or lures packs off the route, or picks the quiet route.
- **Memorable moment:** at the oak, the mother fox steps out, and a trail of tiny lantern lights opens a hidden **fox path**. It's a shortcut toward the guardian's hall that both players can use.
- **Duration:** 4–8 minutes inside the Woodland.
- **Constraints and dependencies:** a new kit entity (Proposal: the dire wolf model scaled to 0.35, tinted orange, with a glow sprite on the tail), its follow/hide logic, the quest tracker (§7), and the fox path (a carved floor corridor added by the generator).

### Entry and knowledge
- **Entry:** the generator places the kit 25–40 m north of the start, in a clearing away from packs. The quest starts when **either** player comes within 6 m (discovery before assignment is the only entry).
- **Prerequisites:** none.
- **Player knowledge at entry:** a sad little glowing fox. A one-line banner: **"A lost fox kit! 🦊 Lead it home to the Hollow Oak."** The tracker shows "🦊 Lead the kit home" with the oak's direction; the oak is already a lit landmark on the minimap.
- **Familiar knowledge:** the tablet shows a big 🦊 **"Lead"** button when close. The kit then follows the familiar.
- **Hook and journal:** "🦊 The Lantern Fox — the kit is lost and scared. Lead it to the Hollow Oak. Keep monsters away from it!"
- **Decline or defer:** just walk away. The kit curls up and waits in its clearing until the guardian dies, then trots home on its own: the arc closes with no reward and no penalty.

### Situation and location
- **What's happening:** the Crystal Bear's rampage scattered the forest creatures, and the kit got separated.
- **Stakeholders:** the fox family wants the kit home. The packs don't care, but their noise scares it.
- **Landmarks and clues:** the Hollow Oak (existing landmark, lit), and a faint trail of lantern-coloured paw prints from the kit's clearing toward the oak (decals every 6 m), so navigation doesn't rely on the minimap.
- **Routes:** the generator already makes **two routes north**. The quest picks the oak so that one route passes 1–2 packs and the other 3–4. The quiet route is longer.
- **Mechanics used:** the follow behaviour is modelled on the pet. The kit's "spooked" state is triggered by awake foes within 10 m, using the existing awake/asleep pack states. It also uses Wind Walk, the Tumble decoy and the familiar's Calm (capybara), Howl (wolf) and Shell (crab), plus the minimap and banners.
- **Fallback for required information:** the paw-print trail, the minimap landmark and the tracker each point to the oak independently.

### Playable beats
| Beat | Player action | Feedback | Emotion | Variation |
| --- | --- | --- | --- | --- |
| Find | Either player walks near the kit | Kit whimpers (sound); banner; 🦊 button on the tablet | Curiosity, concern | Solo: the kit follows the hero |
| Lead | The familiar taps Lead and walks; the kit trots behind | Paw prints glow ahead; tracker distance counts down | Responsibility | |
| Spooked | An awake monster comes within 10 m | The kit yelps and hides under the nearest bush; its tail flickers. Tracker: "The kit is hiding — clear the monsters nearby!" | Protectiveness | Capybara's Calm on the nearby foes, or Wind Walk past them, also counts as "safe" |
| Clear or lure | The hero fights the pack, lures it away (the decoy works well), or both take the quiet route | Once no awake foe is within 10 m for 2 s, the kit peeks out and follows again | Teamwork | |
| Home | The kit reaches the Hollow Oak | The mother fox appears; both tails glow; little lights rise and float to a bush wall that opens into the fox path | Warmth, wonder | |

### Approaches
| Approach | Requirements | Actions | Cost or risk | Success | Failure or recovery |
| --- | --- | --- | --- | --- | --- |
| **Escort and clear** | Hero combat | The hero fights ahead; the familiar waits with the kit, then leads | Time, and fights near the kit spook it | Kit home | The kit hides and never despawns; clear the area and it comes back out |
| **Quiet route** | Find the longer west/east route (the paw prints show both) | Lead along the route with fewer packs | Longer walk; less XP from kills | Kit home faster in practice | As above |
| **Sneak** | Wind Walk, decoy, Calm or Howl | Pull or soothe packs away from the kit's path | Stamina and cooldowns | Kit home without big fights | As above |

### Important decisions
| Decision | Informed intention | Tradeoff | Immediate effect | Acknowledgement | Later effect |
| --- | --- | --- | --- | --- | --- |
| Which route | Paw prints fork; the minimap shows both | Kills and XP vs safety and speed | Different fights | None needed | None |
| Use the fox path to reach the guardian | Lights show where it opens | Skip the rest of the level's packs (less XP and loot) vs reach the bear fresh | Shortcut | The mother fox runs ahead along it | On later runs (proposal, §7.4): the kit appears at the start of the Woodland and leads *you* for a moment |

### State transitions
| Current state | Event and condition | Next state | State writes | Player feedback |
| --- | --- | --- | --- | --- |
| `hidden` | Level built | `waiting` | kit placed | None |
| `waiting` | A player within 6 m | `following` | `q01_status=active` | Banner, tracker, 🦊 button |
| `following` | Awake foe within 10 m of the kit | `hiding` | None | Yelp, hide, tracker hint |
| `hiding` | No awake foe within 10 m for 2 s | `following` | None | Kit peeks out, follows |
| `following` | Kit within 3 m of the Hollow Oak | `home` | `q01_status=done`, `fox_path_open=true`; reward once | Fox family scene, path opens, toast "+ Lantern Charm, +300 XP" |
| `waiting` / `following` / `hiding` | Guardian dies first | `closed` | `q01_status=closed` | Kit trots home off-screen; tracker: "The kit found its own way home" |
| `home` / `closed` | Anything | Same | None | No repeat reward |

### Outcomes and rewards
- **Success:**
  - **XP:** +300 party XP (a little more than a pack).
  - **Lantern Charm:** a familiar *charm* item, rare: +10% familiar speed and a soft glow on the familiar.
  - **The fox path:** opens a route toward the guardian.
- **Partial:** none needed; it's success or a closed arc.
- **Repeated triggers:** the `q01_reward_granted` flag guards against duplicates.
- **World change:** the fox path opens in the level and is drawn on the minimap.
- **Closure:** tracker line struck through with "🦊 Home safe!"

### Recovery and edge cases
- **Early arrival at the oak without the kit:** nothing happens there yet. The tracker isn't shown until the kit has been found.
- **The familiar disconnects mid-escort:** the kit switches to following the hero.
- **Familiar rejoins:** it switches back.
- **The kit can't be hurt:** foes ignore it; it only hides.
- **The guardian is killed first:** the arc closes as above, and the fox path never opens. That's intended and stated.
- **New level:** the state resets; Q01 exists only in the Woodland.
- **Practice room:** the quest is never placed.

### Delivery and review
- **Assets:**
  - fox kit and mother (tinted, scaled dire wolf, plus a tail glow);
  - paw-print decal;
  - a bush wall that opens;
  - two sounds (whimper and yelp; reuse existing synthesis).
- **Code:**
  - kit follow/hide logic (modelled on the pet);
  - the generator places the kit, picks the oak and carves the fox path (closed until opened);
  - quest state machine;
  - tablet Lead button;
  - snapshot fields.
- **New systems:** the shared quest tracker (§7).
- **Checklist:** see §8.

---

## 5. Q02 · The Knight Who Would Not Rest

### Purpose
- **Role:** a meaningful decision whose consequence the players *see* in the boss fight of the same level.
- **Pillars:** Two heroes, two jobs · Pick your way · Kindness shows.
- **Player goal:** deal with the knight's spirit bound in a glowing sarcophagus at *the Grave Obelisk*.
- **Emotional intention:** eeriness → respect or temptation → a satisfying echo at the Necromancer.
- **Central tension:** the knight's blade is a powerful prize right now. Freeing him takes effort and nerve, because skeletons rise while the runes are broken, and its reward comes later.
- **Player contribution:** to free him, the **familiar** solves three rune riddles at three rune stones while the **hero** holds off risen skeletons. To plunder, the **hero** pries the lid.
- **Memorable moment:** freed, Sir Aldric's blue spirit appears beside the heroes when the Necromancer fight begins, and the Necromancer's "Rise!" fails on him with a crack of light.
- **Duration:** 3–6 minutes.
- **Dependencies:**
  - a glowing sarcophagus variant (reuse the sarcophagus prop with blue runes);
  - three rune stones (reuse the obelisk shape, small);
  - a spirit ally (reuse the treant ally logic with the undead knight model, tinted translucent blue);
  - Necromancer fight hooks;
  - the existing riddle UI.

### Entry and knowledge
- **Entry:** either player comes within 8 m of the glowing sarcophagus beside the Grave Obelisk, which is a lit landmark on the minimap.
- **What players learn:** a whisper banner and two lines on the tracker:
  - "*I am Sir Aldric. The Necromancer bound me here.*"
  - "🔵 **Free me:** break my three rune stones, and I will stand with you against him."
  - "⚔️ **Or take my blade**, and he will make me his."
- **Decision information:** both outcomes are stated plainly, so the players can form an intention (§6.2). How strong each one is stays a surprise.
- **Decline or defer:** walk away. The sarcophagus waits until the Necromancer fight starts, then dims: "Sir Aldric sleeps on." No penalty.

### Situation and location
- **What's happening:** the Necromancer bound a fallen knight to guard his crypt. The binding breaks if the runes break, and the bones belong to whoever disturbs them.
- **Stakeholders:**
  - **Sir Aldric** wants rest or redemption.
  - **The Necromancer** wants another champion.
- **Where:** the three rune stones are within 12 m of the sarcophagus, in the same chapel hall, each visible from the others and glowing.
- **Mechanics used:** riddles (the existing Rune Seal UI and generator, three riddles); sarcophagus ambushes (skeletons rising, already built for the Crypt); ally logic; the boss's existing skeleton summons (`summonEvery`).
- **Fallback for required information:** the whisper banner, the tracker lines and a glowing inscription on the sarcophagus (the same two lines, on hover or near it) are three independent sources.

### Playable beats
| Beat | Player action | Feedback | Emotion | Variation |
| --- | --- | --- | --- | --- |
| Discover | Walk into the chapel | The sarcophagus glows and the whisper plays; the tracker shows both options | Eeriness | |
| Free: rune 1–3 | The familiar stands at a rune stone; a riddle appears on the tablet | Right answer: the stone cracks, light rises. Wrong answer: a new riddle (the existing rule), no penalty | Concentration (child) | Solo: the hero shoots each stone in the order shown (1, 2, 3 glow in turn) |
| Free: defend | 2 skeletons rise per stone cracked; the hero keeps them off the familiar | Skeletons crawl out of the hall's sarcophagi (existing ambush code) | Protectiveness (adult) | Low difficulty: Normal skeletons only |
| Freed | The third stone cracks | The lid slides, a blue spirit rises and bows: "*I will be there.*" | Respect | |
| Plunder | The hero holds Interact 1.5 s at the lid (Proposal: an interact key, E) | The lid scrapes open: epic one-handed sword "Aldric's Oath" drops | Temptation fulfilled | |
| Payoff | The Necromancer fight begins | **Freed:** Sir Aldric fights beside you (slams, taunts skeletons), and the Necromancer's summon on him fails with a crack. **Plundered:** at 75% health the Necromancer raises Sir Aldric as a hostile elite Undead Knight ("*You woke him for me!*") | Satisfaction | Left alone: the normal fight |

### Approaches
| Approach | Requirements | Actions | Cost or risk | Success | Failure or recovery |
| --- | --- | --- | --- | --- | --- |
| **Free him (co-op)** | Familiar connected | Three riddles while the hero defends | 6 skeletons; a few minutes | Ally in the boss fight; +250 XP | Wrong answers just swap riddles. If the hero falls, it's the normal run end; nothing quest-specific |
| **Free him (solo)** | Bow or staff (ranged) | Shoot the stones in the shown order | Same skeletons | Same | Melee heroes: walking into a stone and pressing Interact counts as a hit (fallback, so no build is locked out, §9) |
| **Plunder** | None | Hold Interact at the lid | A tougher boss phase later | Epic sword now; +100 XP | None |
| **Leave it** | None | Walk on | Nothing | Normal boss | None |

### Important decisions
| Decision | Informed intention | Tradeoff | Immediate effect | Acknowledgement | Later effect |
| --- | --- | --- | --- | --- | --- |
| Free or plunder | Both stated in plain words, with the boss consequence named | Help later vs power now | Ally promised, or sword in hand | Tracker line; the spirit bows, or the lid lies open | The Necromancer fight changes (above), with a banner at fight start: "Sir Aldric stands with you" or "The Necromancer raises Sir Aldric!" |

Once one path is chosen, the other closes: breaking the first stone locks out plundering, and opening the lid ends freeing. The tracker says so before the first action: "Breaking a rune frees him — opening the lid takes the blade. You can only do one."

### State transitions
| Current state | Event and condition | Next state | State writes | Player feedback |
| --- | --- | --- | --- | --- |
| `sleeping` | A player within 8 m | `bound` | `q02_status=active` | Whisper, tracker, inscription |
| `bound` | Rune stone n cracked (n < 3) | `freeing` | `q02_runes=n` | Stone cracks; 2 skeletons rise; plunder locked |
| `freeing` | Third stone cracked | `freed` | `q02_choice=freed`; reward once | Spirit bows; +250 XP |
| `bound` | Lid opened | `plundered` | `q02_choice=plundered`; sword dropped once | "Aldric's Oath" drops; +100 XP |
| `bound` / `freeing` | Necromancer fight starts | `left` (if `bound`) or `freeing-lost` | `q02_choice=left` | The sarcophagus dims. If some runes were broken: "Too late — the binding holds." No ally, no penalty |
| Any end state | Anything | Same | None | No repeats |

### Outcomes and rewards
- **Freed:**
  - +250 XP;
  - Sir Aldric fights in the boss fight: a spectral ally, invulnerable, about 15 damage per slam every 1.4 s;
  - the Necromancer's skeleton cap drops from 6 to 4, because Aldric "keeps the dead down".
- **Plundered:**
  - +100 XP and "Aldric's Oath", an epic one-handed sword with +damage and +crit (a sure upgrade for knights);
  - in the boss fight, at 75% health the Necromancer raises Aldric as a hostile elite (Undead Knight stats ×1.2).
- **Left alone:** nothing changes.
- **Reward safety:** each reward is granted on its own transition; the `q02_reward_granted` flag guards against duplicates.

### Recovery and edge cases
- **The boss is reached before Q02 is found:** the arc closes silently, with no tracker line ever shown.
- **The familiar disconnects mid-freeing:** the hero can finish with the solo method, and cracked stones stay cracked.
- **The sword is sold or dropped:** the plundered state doesn't change, and the hostile Aldric still rises.
- **The skeletons wake the hall's sleeping packs:** that's fine and part of the defence beat; it's capped by the existing pack rules.
- **Practice room:** never placed.

### Delivery and review
- **Assets:**
  - glowing rune decals on a sarcophagus;
  - three small rune stones with a cracked state;
  - a spirit tint for the undead knight;
  - whisper sound (synth);
  - "Aldric's Oath" item icon (placeholder sword icon, epic backdrop).
- **Code:**
  - quest state machine;
  - riddles at stones (reusing the riddle module) and the tablet riddle UI outside the exit door;
  - Interact key, a production dependency: the game has no "interact" yet, because chests open on touch;
  - spectral ally;
  - Necromancer fight hooks;
  - snapshot fields.
- **Checklist:** see §8.

---

## 6. Q03 · Cages of the War Camp

### Purpose
- **Role:** the strongest "pick your way" quest, with a world change the players see at the next merchant's camp.
- **Pillars:** Pick your way · Kindness shows · Two heroes, two jobs.
- **Player goal:** free the caravan folk caged in the orc war camp, three cages near *the War Banner*.
- **Emotional intention:** urgency → cleverness → pride when the merchant thanks you with his brother beside him.
- **Central tension:** the camp's **alarm**, which is a real system. Once the camp is raised, the guards drag the captives to the keep.
- **Player contribution:**
  - The **familiar** opens cages: it stands at a cage and taps "Unlatch" for 2 s, which a child can do with no timing.
  - The **hero** keeps guards busy, sneaks, or silences the war horns first.
- **Memorable moment:** after the level, the merchant's camp has a new wagon, the freed folk wave, and the stock grows.
- **Duration:** 5–10 minutes.
- **Dependencies:**
  - cage props with captives (Proposal: small villager figures; a placeholder can reuse the hero rig with simple colours);
  - three war horn totems, destructible props with HP;
  - an alarm hook (the existing `alarms` counter);
  - merchant stock and prices reacting to the result.

### Entry and knowledge
- **Entry, either of:**
  1. **At the merchant after level 3**, a new line on the merchant panel: "*Orcs took my brother Pip and the caravan folk. They're caged in the war camp. Bring them home and I'll make it worth your while!*" The tracker starts.
  2. **Directly**: coming within 10 m of a cage. The captives call "Help! Over here!", and the tracker starts with the same goal.
- **What players learn:**
  - three cages, shown on the minimap as soon as one is seen;
  - the war horns are visible tall totems with banners.
- **The rule, in one line:** "**If the camp is raised, they'll be dragged to the keep!**" That's on the tracker. The existing 📯 banner already shows when the alarm goes up.
- **Decline or defer:** ignore it. The cages stay until the Chieftain dies, then the captives are freed by the falling camp: it closes as *freed late* with the smaller reward (§6 outcomes).

### Situation and location
- **What's happening:** an orc raiding party took a merchant caravan. The captives are kept in cages beside the courtyard packs, and the war horns relay the alarm across the camp. The horns are the existing alarm, given a visible source.
- **Stakeholders:**
  - **the merchant**, who wants his brother back;
  - **the captives**, who want out;
  - **the orc guards**, who will move prisoners if raised.
- **Landmarks:**
  - the War Banner (existing landmark) overlooks the courtyard with the cages;
  - three war horn totems stand at the camp's palisade corners;
  - cages sit in sight of sleeping guard packs.
- **Mechanics used:**
  - pack sleep and wake, and the **alarm**: with any horn still standing, a woken pack raises the camp;
  - Wind Walk, the Tumble decoy, Thorn Trap;
  - familiar spells: Calm, Shell, Bubble, Howl;
  - destructible totems (Proposal: destructible props, damaged by any attack).
- **Fallback for required information:** the merchant line, the captives' calls and the tracker each give the goal. The horn rule is shown by the tracker and by the 📯 banner the first time it fires.

### Playable beats
| Beat | Player action | Feedback | Emotion | Variation |
| --- | --- | --- | --- | --- |
| Hook | Read the merchant line, or hear the captives | Tracker: "🔓 Free the caged caravan folk (0/3). Keep the camp quiet!" | Urgency | |
| Scout | Look over the courtyard from cover | Cages, guard packs and horn totems are visible; the minimap marks the cages | Planning | |
| Unlatch | The familiar reaches a cage and holds "Unlatch" (2 s, interruptible, resumes where it left off) | Lock rattles, then clicks open; captives run south off the map; tracker counts up | Teamwork | Solo: the hero holds Interact 3 s |
| Alarm | A guard pack wakes while any horn stands | Horn blares (existing 📯); within 20 s, unfreed captives are marched into the keep (they vanish from the cages; the tracker says "moved to the keep") | Tension | |
| Silence the horns | Destroy the totems (any attack; about 60 HP each) | Each falls with a groan; tracker: "Horns silenced 2/3". With all 3 down, the alarm can't spread | Cleverness | |
| Chieftain falls | Kill the guardian | Captives in the keep are released. Tracker: "Freed after the battle" | Relief | |
| Thanks | Next merchant's camp | A caravan wagon appears; Pip waves; stock and prices change; the merchant thanks you by count | Pride | |

### Approaches
| Approach | Requirements | Actions | Cost or risk | Success | Failure or recovery |
| --- | --- | --- | --- | --- | --- |
| **Quiet** | Patience; Wind Walk, decoy or Calm help | Slip past sleeping packs; the familiar unlatches | Slow; one mistake wakes a pack and the alarm | All 3 freed quietly: the best reward | Raised alarm: switch to the loud or horn approach. Moved captives are freed late |
| **Silence the horns first** | Reach the three totems at the palisade corners | Break each totem (they're away from the cages, guarded lightly) | Time; a fight at each corner | The camp can't be raised, so the cages can be opened even mid-fight | Partial (1–2 horns): the alarm spreads more slowly, 35 s instead of 20 s |
| **Loud** | Strength | Fight the guard packs; the familiar unlatches during the fight | The alarm fires; 20 s to unlatch before guards move the rest | Whatever is freed in time | The rest are freed late, after the Chieftain |

### Important decisions
| Decision | Informed intention | Tradeoff | Immediate effect | Acknowledgement | Later effect |
| --- | --- | --- | --- | --- | --- |
| Approach (quiet / horns / loud) | The alarm rule is on the tracker; horns and guards are visible | Time and risk vs reward | Different fights; captives moved or not | Tracker counts; 📯 banner | Merchant reaction scales with captives freed **before** the Chieftain falls |

### State transitions
| Current state | Event and condition | Next state | State writes | Player feedback |
| --- | --- | --- | --- | --- |
| `unknown` | Merchant hook after level 3, or within 10 m of a cage | `active` | `q03_status=active` | Tracker line |
| `active` | Cage n unlatched (not moved) | `active` | `q03_freed += 1` | Captives run; counter |
| `active` | Horn destroyed | `active` | `q03_horns += 1` | Groan; "Horns silenced n/3" |
| `active` | Alarm raised while horns < 3 | `alarm` | `q03_alarm_t = 20 s` (35 s if any horn is down) | 📯 banner; tracker countdown (pauses while the bag or tree pauses the game) |
| `alarm` | Timer ends | `active` | `q03_moved` = cages still shut | "Moved to the keep" |
| `active` / `alarm` | Chieftain dies | `done` | `q03_late = q03_moved`; reward per count, once | "Freed after the battle" for moved captives |
| `done` | Anything | `done` | None | No repeats |

### Outcomes and rewards
- **XP:**
  - +150 per cage freed directly;
  - +50 per captive freed late.
- **At the next merchant's camp:**

| Freed directly | Merchant |
| --- | --- |
| 3 | "*Pip! You're home!*" Prices −25% this visit, plus one extra **rare** item in stock |
| 1–2 | "*Thank you — the rest made it out after the battle.*" Prices −10% |
| 0 (all late) | "*They're safe, thank the stars.*" One free health potion |
| Quest never found | Nothing |

- **Reward safety:** rewards are granted once, at `done`, and read the counts.
- **Silenced horns:** the alarm stays off for the rest of the level, which is a side benefit with no extra reward. Bypassing combat is rewarded as well as fighting (§9).

### Recovery and edge cases
- **The level is entered without the merchant hook** (the run continued from level 4, or the line was skipped): direct discovery works the same.
- **The familiar disconnects while unlatching:** the hold resumes for whoever comes back, or the hero can do it solo.
- **Cages in sight of a waking pack:** expected; this is the tension.
- **Captives can't be hurt.** Moved captives are never lost, only freed late.
- **Hero death:** the normal run end.
- **Timers:** the alarm timer only runs while the game runs. It pauses with the bag or tree in solo and runs in co-op, as stated in the README.
- **Practice room:** never placed.

### Delivery and review
- **Assets:**
  - cage prop (open and shut);
  - 3 captive figures;
  - horn totem (standing and broken);
  - caravan wagon and Pip at the merchant (UI art or a small portrait);
  - sounds: rattle, click, horn groan.
- **Code:**
  - quest state machine;
  - Unlatch hold on the tablet, and Interact for the hero;
  - destructible props;
  - alarm hook and timer;
  - merchant panel lines, prices and stock changes;
  - snapshot fields.
- **Checklist:** see §8.

---

## 7. Shared quest system (production dependencies)

1. **Quest tracker** (hero HUD and tablet): one line per active quest under the level label.
   - Each line has an icon, a short goal and progress ("0/3"), plus an arrow toward the target.
   - Lines are struck through on completion.
   - Readable for a child: icons first, at most about 8 words.
2. **Quest state machine** (`src/game/quests.ts`, pure and unit-tested):
   - per-run state, with stable IDs (`q01_status`, `q02_choice`, `q03_freed`…);
   - transitions exactly as in the tables above;
   - `reward_granted` flags;
   - included in the snapshot so the tablet mirrors it.
3. **Generator placement:** `levelgen` places the kit, the knight's chapel and the camp's cages and horns from the seed, so the tablet rebuilds the same placement.
   - **Rules:** away from the start; reachable; the fox path is pre-carved but closed.
4. **Optional, later:** a tiny persistent memory across runs, for callbacks like the kit greeting you on later runs and "you freed Aldric last time".
   - It's stored in the browser like the trophies.
   - **Not needed for these three quests.**
5. **Interact key (E on desktop, a button on touch):** for the lid, the solo unlatch and solo rune stones. E is currently the mana potion key, so this needs a key decision: **F** is proposed.

## 8. Acceptance review (§15)

Results without playtest evidence are marked *design-checked*. **Nothing has been playtested yet.**

| Check | Q01 | Q02 | Q03 |
| --- | --- | --- | --- |
| Goal and why it matters are understandable | Design-checked: banner and tracker in under 10 words | Design-checked: both options stated in plain words | Design-checked: merchant line or captives' calls |
| Clear campaign purpose and intended experience | Opening co-op lesson | Decision with boss payoff | Approaches; merchant world change |
| Supported systems, or named new dependencies | §7 plus kit logic | §7, Interact, spirit ally | §7, Interact, destructibles |
| Approaches differ meaningfully | Route, kills and XP vs speed | Ally later vs sword now | Quiet / horns / loud differ in risk, time and reward |
| Critical information has a fallback | Prints, minimap, tracker | Banner, tracker, inscription | Merchant, captives, tracker, 📯 |
| Option wording matches the action | "Lead" | "Free me" vs "take my blade", with the lockout stated | "Unlatch", "silence the horns" |
| Consequences are perceivable | Fox path | Ally or hostile knight at the boss | Wagon, prices, stock |
| Failure, decline, early arrival, interruption defined | Yes (state tables, edge cases) | Yes | Yes |
| Can't block the critical path | Optional; closes on the guardian's death | Closes when the boss fight starts | Closes on the Chieftain's death |
| Rewards match the outcome and can't duplicate | Flag | Flag per path | Counts read once at `done` |
| Truthful journal and closure | Tracker lines | Tracker lines | Tracker lines |
| Distinctive moment involves both players | The familiar leads, the hero clears | Riddles and defence | Unlatching and the horns or the fight |
| Time cost justified | 4–8 min | 3–6 min | 5–10 min |
| Scope fits the budget | Small | Medium | Medium |
| Adult-and-child module (§16) | Low reading, no simultaneous timing, nothing to lose | Riddles are the existing child-friendly ones; wrong answers are harmless | Hold-to-unlatch, no precision; captives never lost |

**Open issues and risks:**
- **Interact key:** needed by Q02 and Q03; F is proposed.
- **Fox path:** it skips part of the Woodland, so it could cost XP. That's intended and offered as a choice. Watch the curve in playtests.
- **Q03's alarm timer:** in co-op it doesn't pause when a panel is open; confirm that's acceptable.
- **Captive and kit art:** placeholders need sign-off.
- **Canon:** this brief's world situation (the Ash King's spreading heat) needs confirming.

**Suggested build order (§11):** build the shared system (§7) with **Q01** first, as the representative quest. Playtest it together, especially whether the familiar player enjoys leading. Then build Q03, then Q02.

## Change log
- 0.1 (2026-10-09): first proposal, three quests from five pitches.
- 0.2 (2026-10-09): Q01 built, with the shared tracker (hero HUD and tablet) and seed-based placement. Changes from the design while building:
  - The kit starts following when a player walks up to it (the familiar if connected, else the hero) instead of a tablet "Lead" button: one less thing to learn for a child.
  - The shortcut is the foxes' **burrow**: step into it at the oak, come out just south of the guardian's hall. This replaces a bush wall opening into a carved path; it has the same outcome without changing the level's walls mid-run.
  - The Lantern Charm drops as loot at the den, so either player can pick it up.
  - No persistent memory across runs yet (§7.4).
- 0.3 (2026-10-10): Q02 and Q03 built. Open questions settled: **F** is the interact key, and the camp's alarm timer keeps running in co-op while a panel is open. Changes from the design while building:
  - **Where they happen:** each level's *middle* landmark. That's the Weeping Obelisk in the Crypt and the Chieftain's Standard in the camp. The Grave Obelisk and the War Banner are the southern landmarks, too near the start.
  - **Q03 unlatching:** stand at the cage (2 s for the familiar, 3 s for the hero), instead of a hold button. Progress is kept if you step away.
  - **Q03 sneaking:** packs only wake for the hero (and Wind Walk hides the hero), so sneaking up to the cages is naturally the familiar's job.
  - **Q03 alarm reach:** an alarm reaches the captives only if it's raised near the cages (20 m) or near a war horn still standing (25 m). Otherwise packs woken at the far end of the camp, before you've seen the cages, would move them unseen. The horns are inert "monsters" (60 HP): arrows, swings and aim-assist work on them. With all three broken, the camp can't be raised at all.
  - **Q03 never found:** if the captives were never found, the merchant says nothing (no potion).
  - **Q02 rune stones:** they're inert props too. The familiar standing at one gets its riddle in the Rune Seal panel, titled "Sir Aldric's Rune". Playing solo, the hero breaks them in order by hitting them (a ring marks the next).
  - **Q02 taking the blade:** hold **F**, or hold the prompt that appears over the action bar (touch). Letting go starts the 1.5 s over; being knocked briefly out of reach only pauses it.
  - **Tracker:** finished lines show for 10 s, then go. The tracker moves below the boss bar during a boss fight.
