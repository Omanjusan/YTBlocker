# YTBlocker

[日本語版はこちら](README.ja.md)

## Purpose

A Firefox extension. It lets users block recommended video cards on YouTube based on rules they set. Some existing add-ons don't handle blocking of video titles containing Japanese text well, so this extension was made to complement that.

## Features

- Works on YouTube only. Hides video cards that don't match your preference (as they appear via infinite scroll) by matching the video title or channel name
- You can optionally hide all Shorts at once via a setting, though fine-grained control isn't available

## Highlights

- Two ways to hide videos
Block directly by video title or channel name from the ︙ menu next to a video (exact match), or by specifying a string in settings
- The ︙ menu also works on recommended video lists shown inside a channel page or during video playback
- Uses Firefox's account storage, so settings can carry over to another environment under the same account (local-only storage is also selectable)

## Installation

~~Search for "YTBlocker" in Firefox add-ons and install it.~~

Currently under review for publication on Firefox Add-ons, so it isn't available yet.

## Usage

Once installed, go to YouTube and just set up blocking rules using either of the two methods below.

### Blocking method 1: Set NG strings from the settings screen

You can register strings to treat as NG (blocked) from the settings screen.
You can evaluate against the video title, the channel name, or both.
Regular expressions are supported, so you can create general-purpose blocking rules too.

![Settings screen sample](settingssample.png)

### Blocking method 2: Block via the ︙ menu next to a video

You can block directly from the ︙ menu next to a video. This is simpler than using strings.

![Button sample](blockmenu.png)

## Notes on behavior

When you navigate to a blocked channel, content owned by that channel isn't blocked at the channel level. It will appear temporarily — this is not a bug. Please understand that the channel card and the content under it are not blocked. Shorts, however, behave according to your settings. Also, already-blocked videos from other channels that appear within that channel's page are still hidden as expected.
