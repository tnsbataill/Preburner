# Intervals.icu Data Availability

This note cross-references the new `Kid.zwo` sample with the Intervals.icu OpenAPI definition to clarify what data the app can reliably pull from synced workouts.

## Structured Workout Metadata (`Kid.zwo`)

The downloaded ZWO file for the "Kid" workout exposes only high-level metadata:

- Author (`<author>`)
- Workout name (`<name>`)
- Description that already includes TSS, IF, and kJ
- Sport type (`<sportType>`)
- Empty `<tags/>` element
- An empty `<workout/>` container with no step definitions

Because the `<workout>` element has no children, there are no interval steps to parse even when using the `resolve=true` download flag. All values we can use from this file are the metadata strings above. 【F:src/samples/Kid.zwo†L1-L9】

## Relevant API Endpoints

The OpenAPI document lists the key endpoints we depend on:

- `GET /api/v1/athlete/{id}/events{format}` – returns calendar events with query parameters for date range filtering, category selection (e.g. `WORKOUT`), and optional conversion of structured workouts to ZWO/MRC/ERG/FIT via the `ext` parameter. Passing `resolve=true` instructs the service to resolve power/HR/pace targets into absolute units. 【F:docs/openapi-spec.json†L1】
- `GET /api/v1/athlete/{id}/events/{eventId}` – fetches the event detail record, which includes any embedded structured workout metadata. 【F:docs/openapi-spec.json†L1】
- `GET /api/v1/athlete/{id}/events/{eventId}/download{ext}` – downloads the structured workout file (e.g. `.zwo`) for an individual event. 【F:docs/openapi-spec.json†L1】

These endpoints cover everything available to the browser client today: bulk event listings, detailed metadata per event, and an optional file download when step-level data exists.

## Event Payload Fields

The `Event` schema in the OpenAPI definition exposes the fields we can rely on without the structured file. Notable properties include:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | Stable identifier for the calendar event. |
| `start_date_local` / `end_date_local` | string | ISO datetimes for the planned window. |
| `category` | string | Filter value (e.g. `WORKOUT`) used when syncing. |
| `name` / `description` | string | Human-readable title and description. |
| `type` / `sub_type` | string | Workout classification strings from Intervals.icu. |
| `indoor` | boolean | Indicates an indoor workout. |
| `moving_time` / `time_target` | integer seconds | Duration-related fields available even when step data is missing. |
| `distance_target` | number | Planned distance when provided. |
| `joules` | integer | Planned work/energy in joules; convert to kJ for nutrition planning. |
| `target` | string | Generic target blob (often JSON) that can include planned load/TSS. |
| `tags` | string[] | Planner tags useful for inferring session type. |
| `workout_doc` | object | Embedded structured workout definition (may be absent or minimal as in `Kid.zwo`). |
| `hide_from_athlete` / `athlete_cannot_edit` | boolean | Flags to respect when displaying events. |
| `carbs_per_hour` | integer | Nutrition-specific guidance from Intervals.icu when present. |

All of these fields are defined on the schema, meaning they are part of the documented contract even if individual workouts omit them. 【F:docs/openapi-spec.json†L1】

## Implications

- Event listings already expose enough metadata (ID, timing, tags, joules, etc.) to populate the planner even when no structured steps are available.
- Step-by-step targets are only available if `workout_doc` or the downloaded `.zwo` file contains interval definitions. The `Kid.zwo` sample shows that some workouts may ship without any steps, so the planner must gracefully fall back to duration and energy fields from the event payload.
- Nutrition fields such as `carbs_per_hour` can be imported directly from the API when present, avoiding duplication of guidance in our app.

This mapping sets expectations for the initial Intervals.icu integration: rely on the event payload for core scheduling/energy data, treat structured files as optional embellishments, and surface any nutrition hints directly from the documented fields.
