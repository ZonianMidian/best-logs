# Best Logs by [Zonian](https://www.twitch.tv/ZonianMidian)

## What is this?

This service provides you with information about logs for a user on a Twitch channel

## Issues / Suggestions

Open a [GitHub Issue](https://github.com/zonianmidian/best-logs/issues).

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure

Copy or edit `config.json`, or use a `config.local.json` file which will take precedence and wont be committed.

| Field                     | Description                                                                                                                                                                                    | Default  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `port`                    | Port the server listens on                                                                                                                                                                     | required |
| `baseUrl`                 | Public URL of the site (e.g. `https://logs.zonian.dev`). Leave empty for local dev.                                                                                                            | `""`     |
| `apiUrl`                  | URL the status page fetches the `/instances` endpoint from. Leave empty when the API and static pages are on the same server. Set to your API url when hosting pages separately (CF/GH Pages). | `""`     |
| `serveStatic`             | Whether Express serves the generated static pages. Set to `false` when hosting pages separately.                                                                                               | `true`   |
| `instances`               | Map of logging instance hostnames to metadata (`maintainer`, optional `alternate` API host).                                                                                                   | required |
| `recentmessagesInstances` | List of recent-messages instance hostnames.                                                                                                                                                    | required |

### 3. Build

```bash
npm run build
```

### 4. Start

```bash
npm start
```
