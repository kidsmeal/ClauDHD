"use strict";
/*
 * Shared constants for ClauDHD scripts.
 *
 * QUICK_CAP: maximum open items in the quick-fixes batch before the overflow
 * warning fires. Kept here so quick.js and brief.js stay in sync.
 *
 * CURSOR_STALE_HOURS: hours since NOW.md was last touched before brief.js
 * flags it as potentially outdated (default 72 hours / 3 days).
 */

const QUICK_CAP = 3;
const CURSOR_STALE_HOURS = 72;

module.exports = { QUICK_CAP, CURSOR_STALE_HOURS };
