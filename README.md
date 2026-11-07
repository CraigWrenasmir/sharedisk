# Sharedisk · for two

Sharedisk is a music box for two iPads facing each other across a table, their far edges touching.

Each player has a keyboard at their own edge. Between them, straddling the seam, a slow brass ring turns like the cylinder of a music box seen from above. Play a key and a pin is set into the ring where it passes your comb. When the pin comes round to the other side, the other player's wooden hands play it on their piano, and a full turn later it comes home to yours. After a few minutes the ring holds a piece neither of you wrote alone.

Live: https://craigwrenasmir.github.io/sharedisk/

## Playing

1. Lay the iPads end to end, each of you at your own edge. Set Auto-Lock to Never.
2. Both open the page, type the same room code, Join.
3. Nothing sounds until you are both holding a key. Then the rings begin to turn.
4. Play. Long notes are long pins. Push the ring with a finger to speed it or slow it (it settles back over half a minute). Tap a pin to take it off. Pins fade over ten turns.
5. The inner ring turns at half the pace, for a slow layer underneath. Each player chooses which ring their pins go into, and their own sound.
6. Keep saves the box as it stands under the name of a park, on both devices. Movements puts a kept one back on the box.
7. Seam sets how far your screen's edge is from the middle of the gap, so the ring meets cleanly across two different iPads.

Playing alone works too (Play alone), and a laptop keyboard plays with A S D F G H J K and W E T Y U, Z and X for octaves.

## How it stays in step

Nothing musical crosses the network. Each device plays its own sound; the only messages are pins, pushes and a shared clock. The ring's angle is a function of server time, which both devices sync over the relay, so a pin sounds at the same moment on both sides however long the box runs. Network delay only affects how soon a new pin appears on the other screen.

## Parts

- `index.html`, `src/app.js`, `src/styles.css`: the page. The ring is a 2D canvas drawn over the whole page; each device draws its half of the shared field, rotated for whichever side it is on.
- `src/stage.js`: the piano and the wooden hands, drawn as an engraved plate. The hands, their measurements and the piano's own synthesised voice come from The Listening Field: Hands (`src/live.js`, `src/hand_spec.json`, `src/wooden_hand.glb`), built on the Mechanical Pianist.
- The relay is `sharedisk.py` in the Universal Sandpit Flask app (`wss://tools.theuniversalsandpit.org/sharedisk/ws`). It holds each room's pins and spin in memory and passes events between the two seats. Rooms live four hours after the last message. Locally the page talks to `ws://127.0.0.1:5077/sharedisk/ws`.

## Local

```
python3 -m http.server 8089          # the page, in this folder
# the relay: flask-sock mounted on a Flask app, see universal-sandpit/sharedisk.py
```
