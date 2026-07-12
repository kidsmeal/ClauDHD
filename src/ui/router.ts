// Hash-state router: #/ fleet, #/p/<name> detail, #/settings.

import type { Route } from "./store.js";

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  if (h.startsWith("p/")) return { view: "detail", name: decodeURIComponent(h.slice(2)) };
  if (h === "settings") return { view: "settings" };
  return { view: "fleet" };
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case "fleet":
      return "#/";
    case "detail":
      return "#/p/" + encodeURIComponent(route.name);
    case "settings":
      return "#/settings";
  }
}
