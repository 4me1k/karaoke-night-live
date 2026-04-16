# Karaoke Night Live App

Simple real-time karaoke queue app for parties.

## Features

- Guests submit:
  - Song
  - Artist
  - Requester name
- Built-in QR code:
  - Guests scan and open the live page quickly
- Everyone sees:
  - Current song (now singing)
  - Next songs in the queue
  - TV mode on the same URL (toggle button) for current song, next song, and live lyrics
- Host controls (admin PIN only):
  - Move to next song
  - Reset queue
  - Remove a specific song from queue

## Run locally

1. Start the app:

   ```bash
   node server.js
   ```

2. Open:

   - Main screen: [http://localhost:3000](http://localhost:3000)
   - Use the **Switch to TV Mode** button to change the layout

Open the same URL on multiple devices in the same network (using your computer IP) to use it live during karaoke night.

## Admin PIN

- Default admin PIN is `karaoke123`
- Set your own when starting server:

  ```bash
  ADMIN_PIN=your-secret-pin node server.js
  ```

## Lyrics

- Lyrics are fetched live from a public lyrics provider using song + artist.
- If no lyrics are found (or provider is down), the app shows a friendly fallback message.
