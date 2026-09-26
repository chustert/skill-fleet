# Desktop platform guide

Applies to macOS, Windows, and Linux applications, native or built with
frameworks such as Electron, Tauri, Qt, or .NET. `docs/agents/verification.md`
holds the real commands. This guide supplies the defaults.

## Test seams

- Pure logic in modules that do not import the UI toolkit.
- View models and commands with injected file system, clock, network, and
  process clients.
- File formats through round trips: write, read back, and read files written by
  older versions.
- IPC between processes, such as Electron's main and renderer or a helper
  process, through its message contract.
- UI flows through the project's existing harness, such as XCUITest,
  WinAppDriver, Playwright for Electron, or the toolkit's test driver.

Do not add a harness as incidental work. Record the gap instead.

## Runtime evidence

Report separately:

- **Automated checks:** tests, lint, and a build for each operating system the
  change affects that can build locally.
- **Local run:** launch the development build, perform the criterion's steps,
  and record what happened, with screenshots and logs stored outside the
  repository.
- **Other operating systems:** a behaviour that differs by operating system,
  such as paths, file permissions, menus, shortcuts, window management, or
  installers, is `Not verified` on a system that could not run locally.
- **Packaging and distribution:** code signing, notarization, installers,
  auto-update feeds, and app stores need credentials and often online services.
  Ask before using them, and never publish.

## Bug feedback loops

- A saved document, settings file, or profile that reproduces the problem.
- Command-line flags or environment variables that open the failing state.
- The application log with debug logging turned on for one run, tagged so the
  change can be removed.
- The platform profiler for hangs and memory growth.

## Compatibility at boundaries

- Users run older versions for a long time, especially without auto-update.
  Documents, settings, and local databases need readers for older formats.
- Auto-update moves users between versions. The updater and the update feed
  are a contract of their own.
- Plugins, extensions, and scripting APIs are public contracts.
- Operating system versions and CPU architectures the project supports bound
  which APIs and binaries a change can use.

## Visible-first order

For teaching and slice planning: the window, panel, or dialog with placeholder
content, then interaction states, then the command or view model contract, then
the service behind a stub, then real file, network, and process integration,
then replacing the placeholders, then checks on each supported operating
system.
