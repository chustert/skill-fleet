# Mobile platform guide

Applies to iOS and Android apps, including apps built with cross-platform
frameworks such as Flutter or React Native, and SDKs embedded in other apps.
`docs/agents/verification.md` holds the real schemes, tasks, destinations, and
commands. This guide supplies the defaults.

## Test seams

- Pure logic in a module or package without UI framework imports, such as a
  Swift package target or a Kotlin module.
- View models, reducers, and use cases with injected clients, clocks, storage,
  and randomness.
- Persistence through an in-memory or temporary store, including migrations
  from every older schema version still installed.
- Networking through an injected client protocol or a local stub server.
  Decode fixtures captured from the real API, redacted.
- UI flows through the project's existing harness, such as XCUITest, Espresso,
  Compose UI tests, Maestro, or Detox. Use snapshot tests only where the project
  already uses them.

Do not add a test target or UI harness as incidental work. Record the gap
instead.

## Runtime evidence

Keep these categories separate in every report:

- **Automated local checks:** the build and tests that actually ran, with the
  scheme or build variant, the destination or emulator, and the result, such as
  `xcodebuild test -scheme <scheme> -destination '<destination>'` or
  `./gradlew testDebugUnitTest`.
- **Simulator or emulator:** checks run or not run, the device model and OS
  version, and known limits. A simulator limit is not a device failure. Camera,
  several sensors, push delivery, Bluetooth, background execution limits, and
  real performance need hardware.
- **Physical device:** camera, sensors, connectivity changes, permission
  prompts, backgrounding, notifications, signing, and installation. Give the
  user exact steps and the expected result, and record what they observed.
  Never claim a device pass from a build.
- **Credentials and local configuration:** name the missing category, such as a
  signing identity, provisioning profile, or API key file, without opening,
  printing, or quoting the protected file.
- **Hosted services and distribution:** remote backends, push services,
  TestFlight, and Play Console tracks are online targets and need explicit
  approval.

An unavailable simulator, disconnected device, missing signing identity, or
unavailable hosted service produces `Not verified` for the affected claim,
reported apart from test failures and code defects.

## Bug feedback loops

- Launch arguments or environment flags that open the failing screen with
  seeded data.
- A captured, redacted API response replayed through the stubbed client.
- Network conditioning on the simulator, emulator, or device for connectivity
  bugs, and airplane mode for offline paths.
- Symbolicated crash logs from the matching build, and the platform profiler,
  such as Instruments or the Android Studio profiler, for performance.

## Compatibility at boundaries

- Installed apps update slowly, and old versions stay in use for months. A
  server or API change must keep working with every app version the project
  still supports, unless it enforces a minimum version.
- Local persisted data, such as SQLite, Core Data, SwiftData, Room, files,
  keychain, and preferences, needs a migration path from every older schema.
- The project's minimum OS versions and supported devices bound which APIs a
  change can use.
- An SDK embedded in other apps is also a library boundary. Read the
  [library and CLI guide](library-cli.md).

## Visible-first order

For teaching and slice planning: the screen with placeholder state, then
navigation and interaction states such as loading, empty, error, and offline,
then the view model contract, then the client or service layer behind a stub,
then real networking and persistence, then replacing the placeholders, then
simulator and device checks.
