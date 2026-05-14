# Prairie Dog Locator PRD + MVP Plan

## Summary

Build a map-first web app that shows recent public prairie dog observations across the U.S. as animated radar-like pings. For MVP, treat "real time" as short-interval polling of public APIs, not proof of a live animal at that exact moment.

Use iNaturalist as the launch data source because it already provides prairie dog taxonomy, public source URLs, photos, timestamps, and coordinates. I confirmed the current iNaturalist query returns usable geolocated prairie dog records: `taxon_id=46175`, `place_id=1`, `has[]=geo`, `has[]=photos`, `order_by=created_at`.

## Key Changes

- Create a local TypeScript console collector that polls iNaturalist every 60-180 seconds, deduplicates source IDs in memory, prints one normalized JSON event per line, and appends to `data/events.jsonl`.
- Create a local viewer with a simple U.S. map, no database, and a local SSE endpoint so incoming JSON events appear as green pulsing/radar dots.
- Use this normalized event shape: `event_id`, `source`, `source_item_id`, `source_url`, `detected_at`, `source_created_at`, `match`, `taxon`, `location`, `media`, and `raw`.
- Plot only records with coordinates. Preserve source privacy fields such as `obscured`, `geoprivacy`, `positional_accuracy`, and `public_positional_accuracy`.
- Include seed events so the viewer is useful when no brand-new prairie dog observation arrives during testing.

## Feed Strategy

- MVP source: iNaturalist observations API, genus `Cynomys` / taxon ID `46175`, U.S. place filter, georeferenced observations, photos, newest first. Respect iNaturalist guidance of about 1 request/second and roughly 10k requests/day.
- Optional second source: Flickr photo search for `prairie dog`, `prairiedog`, and `cynomys`, restricted to geotagged public photos. This requires a Flickr API key, and Flickr currently limits API key requests to Pro subscribers.
- Optional "social mention" feed: Bluesky Jetstream or search can detect text mentions, but Bluesky posts do not normally carry reliable lat/lng, so these should go into a non-plottable mention stream unless explicit coordinates are present.
- Defer Mastodon, Reddit, Instagram, and X for launch. Mastodon/Reddit usually lack coordinates; X can search `has:geo` but now uses pay-per-usage API access.

## Viewer Requirements

- First screen is the working locator, not a marketing page.
- Map occupies the primary canvas; side inspector shows selected event details and raw JSON.
- New markers animate with a green dot, scale-in, and 2-3 expanding ripple rings over roughly 1.5-2.5 seconds.
- Marker click opens title, source, timestamps, species/keyword match, coordinates, location confidence, thumbnail if available, and original source link.
- Local MVP can use D3 + static U.S. GeoJSON. Public deploy should move to MapLibre GL JS with a compliant basemap such as Protomaps/PMTiles rather than relying on OpenStreetMap public tiles.

## Test Plan

- Console collector: verify it prints normalized JSON, includes a stable source URL, includes coordinates when available, deduplicates repeated observations, and handles empty/API-error responses without crashing.
- Data quality spike: confirm at least one recent iNaturalist prairie dog event has taxon data, photo data, coordinates, and an original observation URL.
- Viewer: verify seeded and live events render on the U.S. map, pulse animation runs, inspector opens, and non-plottable events are excluded or clearly labeled.
- Deployment readiness: verify polling interval stays within source API guidance and the app still runs without any database.

## Assumptions

- "Real-time" means near-real-time feed polling for MVP.
- Launch app does not store replay history; JSONL is only for local inspection and demo replay.
- No scraping. Use public APIs only.
- iNaturalist is the required MVP source; Flickr is optional after you obtain a key.
- Sensitive or obscured locations must remain as provided by the source.

## References

iNaturalist API and rate guidance: [API](https://www.inaturalist.org/api), [recommended practices](https://www.inaturalist.org/pages/api+recommended+practices)
Flickr setup/search: [API keys](https://www.flickr.com/services/api/misc.api_keys.html), [photo search](https://www.flickr.com/services/api/flickr.photos.search.html), [Flickr API help](https://www.flickrhelp.com/hc/en-us/articles/4404070036884-Flickr-API)
Bluesky: [Jetstream](https://docs.bsky.app/blog/jetstream), [post search](https://docs.bsky.app/docs/api/app-bsky-feed-search-posts)
Maps: [MapLibre GL JS](https://maplibre.org/projects/gl-js/), [Protomaps PMTiles](https://docs.protomaps.com/), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
Other APIs considered: [Mastodon streaming](https://docs.joinmastodon.org/methods/streaming/), [Reddit Data API](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki), [X pricing](https://docs.x.com/x-api/getting-started/pricing), [X search operators](https://docs.x.com/x-api/posts/search/integrate/operators)
