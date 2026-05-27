# UI System Deep Dive

## How UI Works in Hytopia

Each player has their own `player.ui` which loads a standard HTML/CSS/JS page.

Key methods:
- `player.ui.load('assets/ui/index.html')`
- `player.ui.setState({...})` — sends data to the loaded HTML
- Listening for `player.ui.on('data', ...)` on the server side

## Best Practices

### Keep UI "Dumb"
The HTML/JS in `assets/ui/` should primarily:
- Display state it receives
- Send simple commands back to the server (`hytopia.sendData(...)`)

Do **not** put significant game logic in the UI layer.

### Use a Clear Payload System
Define all possible UI payloads in one place (see `GehennaUiPayload` types in the current codebase). This prevents magic strings and makes it easy for AIs to understand what data can flow.

### Multiple Screens vs Single Page
For complex games like Gehenna, it is usually cleaner to have one HTML file that switches between different screens (Menu, HUD, Run End, etc.) using CSS classes or a small JS router, rather than loading completely different HTML files.

### Styling
- The custom font (Daemones) is already being used.
- Keep the visual language consistent with the industrial/screamo aesthetic of the project.

## Performance
Heavy DOM updates every frame will hurt. Use the state update system and only re-render what actually changed.

## Current Project Status
The `assets/ui/index.html` already handles menu ↔ HUD switching and several payload types. It is relatively advanced for the current stage of the port.

Future work will likely involve:
- More polished HUD elements
- Weapon wheel / inventory UI
- Upgrade / purchase screens
- Run end statistics screen

Document new UI payloads and screen types here as they are added.
