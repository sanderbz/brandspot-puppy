# Brandspot Puppy – Web Crawling API

*A minimal, production-ready Node.js service for privacy‑respecting web crawling and article extraction.*

---

## Table of Contents

1. [Features](#features)
2. [Quick Start](#quick-start)
3. [API Reference](#api-reference)
4. [Example Requests](#example-requests)
5. [Configuration](#configuration)
6. [Project Layout](#project-layout)
7. [Environment Variables](#environment-variables)
8. [Support](#support)

---

## Features

### Core

* **Fast HTTP server** — built with **Fastify** for low latency and minimal overhead.
* **Full‑page crawling** — powered by **Puppeteer** to render JavaScript‑heavy sites.
* **Clean article extraction** — uses **@mozilla/readability** to isolate main content.
* **Markdown output** — converts HTML to Markdown with a multi‑tier conversion strategy.
* **Flexible workflow** — runs in **test mode** (logs to console) or **production mode** (webhook callback).

### Privacy & Stealth

* **Ghostery Adblocker** — blocks ads, trackers and unnecessary resources.

* **Stealth plugins** — **puppeteer‑extra** & **stealth** plugin minimise bot detection.

### Resilience & Performance

* **Persistent browser** — a single Chromium instance shared across requests.
* **Automatic restart** — restarts after *24 h* or *1 000* requests to avoid leaks.
* **Page‑per‑request** — lightweight page objects created and disposed per call.
* **Structured logging & error isolation** — timestamped logs with stack traces.

---

## Quick Start

```bash
# install dependencies
pnpm install        # or: npm install

# development (hot reload)
pnpm dev

# production
pnpm start
```

The server listens on **`PORT`** (default **`3000`**).

---

## API Reference

### `POST /crawl`

Crawl a page and extract its main article.

| Field          | Type      | Required | Description                                         |
| -------------- | --------- | -------- | --------------------------------------------------- |
| `url`          | `string`  | ✔︎       | Page to crawl.                                      |
| `callback_url` | `string`  | ✖︎\*     | Webhook to receive the result (omit in test mode).  |
| `test`         | `boolean` | ✖︎       | Log result to console instead of sending a webhook. |

<details>
<summary>Response (identical in test & production mode)</summary>

```jsonc
{
  "message": "Request accepted and processed"
}
```

</details>

#### Webhook / Test‑mode Payload

```jsonc
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "byline": "Author Name",
  "markdown": "# Article Title\n\nArticle content in markdown...",
  "extracted_at": "2025-01-15T12:00:00.000Z"
}
```

---

### `GET /health`

Returns browser statistics and configuration.

```jsonc
{
  "status": "ok",
  "timestamp": "2025-01-15T12:00:00.000Z",
  "browser": {
    "initialized": true,
    "requestCount": 42,
    "ageMinutes": 120,
    "maxRequests": 1000,
    "maxAgeMinutes": 1440
  },
  "config": {
    "debug": false,
    "navigationTimeout": 30000,
    "conversionTimeout": 5000
  }
}
```

---

## Example Requests

<details>
<summary>Test mode (logs result)</summary>

```bash
curl -X POST http://localhost:3000/crawl \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article","test":true}'
```

</details>

<details>
<summary>Production mode (webhook)</summary>

```bash
curl -X POST http://localhost:3000/crawl \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article","callback_url":"https://your-service.com/webhook"}'
```

</details>

<details>
<summary>Health check</summary>

```bash
curl http://localhost:3000/health
```

</details>

---

## Configuration

All tunables are centralised in **`config.js`**.

| Setting                      | Default | Purpose                                    |
| ---------------------------- | ------- | ------------------------------------------ |
| `browser.maxAgeMinutes`      | `1440`  | Restart persistent browser after N mins.   |
| `browser.maxRequests`        | `1000`  | Restart browser after N requests.          |
| `page.navigationTimeout`     | `30000` | Max navigation time per request (ms).      |
| `markdown.conversionTimeout` | `5000`  | Abort HTML→Markdown conversion after N ms. |
| `debug`                      | `false` | Verbose logging toggle.                    |

---

## Project Layout

```
brandspot-puppy/
├─ server.js          # HTTP server & routes
├─ browser.js         # Browser lifecycle & page factory

├─ config.js          # Application settings
├─ package.json       # Scripts & dependencies
└─ README.md          # You are here
```

---

## Environment Variables

| Variable   | Default       | Description                                  |
| ---------- | ------------- | -------------------------------------------- |
| `PORT`     | `3000`        | HTTP listening port.                         |
| `NODE_ENV` | `development` | Runtime mode (`development` / `production`). |

---

## Support

Please use the GitHub **Issues** tab for questions or bug reports. Pull requests are welcome.