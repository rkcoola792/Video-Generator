# Documentation index

These documents specify the product before implementation.

| Document | Purpose |
|---|---|
| [PRD.md](../PRD.md) | Confirmed product goals, v1 requirements, and exclusions. |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System components, workflow, data flow, and implementation phases. |
| [API.md](API.md) | App HTTP API conventions, endpoint map, and user workflow. |
| [api/openapi.yaml](api/openapi.yaml) | Machine-readable OpenAPI contract for the app API. |
| [BACKEND.md](BACKEND.md) | Backend modules, provider interfaces, jobs, approvals, and local configuration. |
| [DATABASE.md](DATABASE.md) | Relational model, versioning, constraints, retention, and migration approach. |
| [schema.sql](schema.sql) | Initial PostgreSQL DDL proposal. |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Gemini, ElevenLabs, Remotion, Instagram, and music integration boundaries. |
| [PROTOTYPE.md](PROTOTYPE.md) | How to run the first local video studio prototype and what it includes. |

## Decisions recorded

- Local-first development.
- Gemini API for script/storyboard generation.
- ElevenLabs for voice generation.
- Remotion for animation, preview, and MP4 rendering.
- Image generation vendor and hosting provider remain undecided.
