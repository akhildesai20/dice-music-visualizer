# Dice

A top-down field of monochrome dice, cropped by the viewport so the lattice reads as a continuous surface. Each pip blinks on its own. Bass sends a ring out from the center; low mids lift the surface; mids send an occasional sideways wave; highs stir the lamps. Every cube takes one quarter-turn or half-turn, then sits flat again.

The cube shape, pip layout, and quaternion convention come from the [dice](https://github.com/akhildesai20/dice) experiment. This is a separate piece, not a mode of that dice roller.

## Run

```bash
npm test
npm start
```

Open `http://localhost:5173`. ES modules need a local server; opening the file directly will not load.

Demo loads `demo/emergency.mp3` when that file is next to the page. Play is then ready without an upload.

## Deploy

The site is static. On [Vercel](https://vercel.com), import the GitHub repo, leave the framework as Other, and leave the build command empty. `vercel.json` tells Vercel to publish this directory as-is.

Upload an MP3, WAV, or MIDI file, or switch the input to the microphone. Play asks for fullscreen and hides the panel. Pause, or Esc, leaves fullscreen. The microphone is analysed and is not played back. MIDI is rendered with a small synthesizer so the same frequency response drives the field. Move the pointer or press `C` to bring the transport back.

Loudness brightness, under Appearance, is off until you enable it. It leaves the pip blink alone and raises or lowers the field with the overall level. Save preset keeps the current settings in this browser. Reset returns the factory values.

Waves can be fired before any music is loaded.

## Architecture

| Module | Role |
| --- | --- |
| `src/diceGrid.js` | Lattice larger than the viewport, orientations, grayscale ranks, blink seeds |
| `src/renderer.js` | Instanced mesh, lighting, per-pip emission, bloom |
| `src/waveEngine.js` | When a radial, left-to-right, or right-to-left front reaches each die |
| `src/animationEngine.js` | Per-die turn queue, eased slerp, hop, snap back to a cube rotation |
| `src/audioAnalyzer.js` | Normalized energy, bands, brightness, and transients from an `AnalyserNode` |
| `src/audioMap.js` | Which feature drives which channel. Edit this to retune the piece |
| `src/bass.js` | Bass onset detector and the map from bass strength to a radial wave |
| `src/themes.js` | Palette. Add a key to introduce another color family |
| `src/ui.js` | Controls |

The analyzer never imports the wave engine. `audioMap.js` turns a feature frame into a radial wave, a horizontal wave, an elevation amount, pip activity, and an illumination level. `onBass({ strength, timestamp })` is still the direct way to fire a center ripple without audio.

## Rendering tradeoff

The reference renderer raymarches one rounded box in a full-screen pass, then repeats that pass per die. At 1,600 dice that is thousands of full-frame marches, which will not hold 60 fps.

This build keeps the same signed-distance rounded box (`radius = 0.16 × half-extent`) and the same procedural pip tables, but evaluates the surface once into a mesh. Every die is an instance of that mesh: one draw for the lit cubes, one draw for pip emission, then a half-resolution blur composited additively. Orientations, colors, blink seeds, and flashes live in instance buffers. Six pip oscillators are derived in the fragment shader from each die's seed, so a face of six does not share one blink and no extra meshes are created. Nothing in the frame loop allocates per die.

Cube pitch comes from the density setting (40 across a 960px reference), not from fitting a fixed grid into the window. The lattice is then grown, with a one-cell overscan, until every edge of the viewport cuts through a die. A phone shows fewer of the same-sized cubes. The density steps 10, 20, 30, and 40 change that pitch. Instance count is capped near 8,000 by enlarging the pitch, and device pixel ratio drops as the field gets heavier.

Three.js is not used. The instance path is a few draw calls of a shared mesh; a scene graph would not change the bottleneck.

## Motion

Resting orientations are the 24-element rotation group of the cube, so a face is always toward the camera and the in-plane twist is a multiple of 90°. A wave appends one local turn — ±90° or ±180° about X, Y, or Z — to that die's queue. The mesh slerps from the snapped start of the turn to the snapped end. If another wave arrives mid-turn, the new turn waits. It is never multiplied onto a half-finished orientation. X/Y stay on the lattice. A short hop lifts tumbles clear of the ground plane and returns to zero. Musical elevation is a separate shader offset, added only while preparing the draw, and it falls back to the plane when the low mids do. The camera stays orthographic and straight down, so a pure height change would not move a cube on screen. The same offset is also applied along the screen’s up axis, and it returns to zero with the music, leaving the stored lattice untouched.

Horizontal waves add a stable per-die offset smaller than half a column, so a row is not a perfect metronome. The radial wave does not. Distance is measured in grid cells from the screen center, or from the leading column. The center of the lattice is the origin, including when the field is wider than it is tall.

Bass strength scales how far the ring travels, how fast it moves, and how hard the turns are. The detector arms on a rise through an adaptive threshold and stays disarmed until the low band falls, so a sustained note is one ripple. Mid-band rises do the same for sideways waves, alternating direction, with their own cooldown. Highs scale pip rate and add short per-pip flashes. Overall energy is a multiplier on those channels, not a shared blink. Spectral brightness nudges shader illumination; each cube keeps the grayscale it was given at creation. Followers use a fast attack and a slow release, and a steady loud mix settles below full scale.

## Themes

`src/themes.js` is the only palette. `hue` is 0–360. `saturation`, `minLightness`, and `maxLightness` are 0–100. Each die keeps a random rank in that lightness range, so moving the gray sliders remaps the field without shuffling it. Pip off/on colors are the emissive endpoints. Adding a theme is a new object in `themes`; the menu lists `Object.keys(themes)`.
