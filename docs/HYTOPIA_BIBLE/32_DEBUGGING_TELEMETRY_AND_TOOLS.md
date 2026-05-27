# Debugging, Telemetry & Tools

## Server-Side Debugging

- All `console.log` from the server appears in the terminal running `hytopia start`.
- The project already has some debug logging to `debug-agent-de4214.log`.
- Use structured logging when possible (JSON lines) so it is easier to parse later.

## Client-Side Debugging

- Normal browser DevTools work on the play page.
- You can log from the UI HTML/JS layer.
- Network tab is useful for seeing the data being sent/received.

## Built-in Hytopia Tools

- The platform has some telemetry options (Sentry integration is mentioned in the SDK).
- Check the current SDK version's telemetry capabilities.

## Recommended Custom Tools for Project Gehenna

- Wave statistics (enemies spawned, time per wave, average kills, etc.)
- Per-player performance metrics (if possible)
- Economy flow tracking (where money is coming from and going)
- Error aggregation

## When Things Go Wrong in Production

Local reproduction is king. Build tools that let you simulate bad states locally.

Document any custom debugging commands or admin tools you add to the game here.
