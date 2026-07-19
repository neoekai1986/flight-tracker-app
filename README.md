# Fare Board

A single-page, no-backend dashboard for manually tracking flight prices —
useful for sites like Southwest that block automated price lookups.

**Live at:** enable GitHub Pages on this repo to get a permanent URL.

## Privacy model

This repo and its hosted page contain **no personal flight data** — no
prices, no URLs, no notes. Everything you enter (groups, flights, prices,
notes) is saved only in your browser's local storage. It is never sent
anywhere and never committed to this repo.

To move your data between browsers or devices, use the **Export data** /
**Import data** buttons on the page itself — export gives you a JSON file
you keep yourself; import loads one back in.

## Features

- Organize flights into renamable groups
- Track price paid in cash, points, or both
- Split round-trips into outbound/return legs, shown side by side
- Move a flight between groups
- One button to open every tracked flight's search link in new tabs
- Editable price-check log per flight, with delta vs. what you paid and
  an alert-threshold indicator
