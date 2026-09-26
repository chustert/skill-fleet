# Game platform guide

Applies to games built in an engine such as Unity, Unreal, or Godot, or in a
custom engine, together with their dedicated servers, tools, and content
pipelines. `docs/agents/verification.md` holds the real commands, engine
version, and target platforms. This guide supplies the defaults.

## Test seams

- Game rules as plain code that runs without rendering: damage, economy,
  inventory, progression, AI decisions, and procedural generation with a fixed
  seed.
- A fixed-timestep simulation step: advance a known number of ticks with
  scripted inputs and assert the resulting state.
- The engine's test framework the project already uses, such as Unity Test
  Framework in Edit Mode for logic and Play Mode for scene behaviour, Unreal
  Automation and Functional Tests, Godot GUT or GdUnit4, or the custom engine's
  harness. Run it headless or in batch mode where the engine allows.
- Save and load round trips, including files written by older builds.
- Network messages encoded and decoded against fixtures, and server-authoritative
  rules through a headless server.
- Content validation: every item, level, localisation string, or table row
  passes schema and reference checks.

Do not assert on timing that depends on frame rate unless the timestep is
fixed. Do not add a test framework as incidental work. Record the gap instead.

## Runtime evidence

Report these categories separately:

- **Automated checks:** engine tests in batch mode, content validation, and a
  build for each target platform the change affects that can build locally.
- **Play-test:** exact steps for the editor or a development build, with the
  scene or level, the starting state, the inputs, and the expected observation.
  Record who played, on which build and platform, and what they saw. Feel,
  readability, difficulty, and fun need a human play-test. Mark them
  `Not verified` until one happens, and say who should play.
- **Performance:** frame time, memory, load time, and draw calls measured with
  the engine profiler on the target hardware, compared with a recorded
  baseline. An editor measurement is not a device measurement.
- **Platforms and input:** consoles, handhelds, VR headsets, and phones need the
  hardware, and consoles need dev-kit access. Controller, touch, and keyboard
  with mouse are separate evidence. Whatever could not run is `Not verified`.
- **Online services:** matchmaking, leaderboards, achievements, storefront and
  platform services, analytics, and live-operations backends are online
  targets and need explicit approval.

## Bug feedback loops

- A save file, replay, or recorded input sequence that reproduces the bug.
- A fixed random seed and a fixed timestep to turn a flaky bug into a repeatable
  one.
- A debug command, cheat, or test scene that jumps straight to the failing
  state.
- Frame stepping in the engine debugger, and the profiler for spikes.
- Bisecting builds or commits with an automated reproduction scene.

## Compatibility at boundaries

- Save files outlive builds. Version them, and keep loading every version still
  in players' hands.
- In multiplayer, clients and servers of different versions can meet. Version
  the protocol, and reject or adapt a mismatch explicitly.
- Patches, downloadable content, and asset bundles reference each other across
  versions.
- Mods and user-generated content depend on public file formats and scripting
  APIs.
- Platform certification rules can constrain save handling, suspend and resume,
  and online behaviour.

## Visible-first order

For teaching and slice planning, work playable-first: greybox the interaction
with placeholder art and hard-coded values so it can be played, then add
placeholder feedback such as animation, sound, and UI, then extract the rule
into testable code, then move tunable values into data, then add saving and
loading, then networking where the game has it, then replace placeholder
assets, then play-test and profile.
