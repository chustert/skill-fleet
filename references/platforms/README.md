# Platform guides

Each guide gives the default test seams, runtime evidence, bug feedback loops,
compatibility risks, and visible-first teaching order for one kind of software.
`docs/agents/verification.md` records each component's platform and its real
commands. Where the two disagree, the project's file wins.

| Platform | Guide | Covers |
| --- | --- | --- |
| `web` | [web.md](web.md) | Browser applications and sites, with server routes that ship alongside them |
| `mobile` | [mobile.md](mobile.md) | iOS and Android apps, including cross-platform frameworks |
| `desktop` | [desktop.md](desktop.md) | macOS, Windows, and Linux apps, including Electron and Tauri |
| `game` | [game.md](game.md) | Games in Unity, Unreal, Godot, or a custom engine, and their servers and tools |
| `service` | [service.md](service.md) | Back-end services, APIs, workers, databases, and infrastructure |
| `library-cli` | [library-cli.md](library-cli.md) | Libraries, SDKs, packages, plugins, and command-line tools |

A component can span two platforms, such as a web app with its own API routes.
Read both guides and apply each where it fits.

For a platform without a guide, recorded as `other`, use this order of
evidence: an automated check at a public seam, then a local run of the real
artifact with a recorded observation, then precise steps for the user to run
with the expected result. Report each category separately and mark whatever
could not run `Not verified`. To add a platform, write a guide with the same
sections in the fleet and reinstall.
