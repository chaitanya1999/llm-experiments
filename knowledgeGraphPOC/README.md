# Knowledge Graph POC

Prototype personal knowledge management system that extracts graph facts from text, stores them in Neo4j, indexes them in ChromaDB, and answers questions with a hybrid vector + graph RAG flow.

This README is written for humans and AI agents that need to understand or extend the codebase quickly.

## High-Level Architecture

```text
User text
  -> src/cli/ingest.js
  -> IngestionService
  -> LLM provider extracts { nodes, relations } JSON
  -> normalizeGraphPayload()
  -> Neo4jGraphStore.upsertGraph()
  -> ChromaVectorStore.upsertGraphIndex()

Question
  -> src/cli/ask.js
  -> HybridRagService
  -> ChromaVectorStore.queryNodes()
  -> Neo4jGraphStore.expandFromNodes()
  -> formatGraphContext()
  -> LLM provider generates final answer

Web UI
  -> src/server/server.js
  -> Express JSON APIs + static files
  -> same IngestionService and HybridRagService used by the CLIs
  -> graph preview from Neo4jGraphStore.getGraphPreview()
```

## Runtime Stack

- Node.js ES modules; package root is the repository root.
- LLM providers:
  - Gemini via `@google/genai`, default model `gemini-2.5-flash`.
  - Ollama via local HTTP API, default model `mistral`.
- Graph database: Neo4j using the official `neo4j-driver`.
- Vector database: ChromaDB using `chromadb` and the default embedding package.
- Web server: Express serving JSON APIs and static HTML/CSS/JS.
- Graph UI: Graphology for the browser graph model, Graphology force layout for positioning, and Sigma for canvas rendering.
- Prompt files live under `knowledgeGraphPOC/prompts`.

## Important Files

- `src/config.js`: central config loader. Reads environment variables first, then `knowledgeGraphPOC/config.json`, then selected legacy fields from repo-root `config.json`, then hardcoded defaults.
- `src/input/readInput.js`: shared CLI argument parser for `--file`, `--interactive`, `--provider`, and positional text.
- `src/cli/ingest.js`: ingestion entry point with a large fallback sample graph text.
- `src/cli/ask.js`: question-answering entry point.
- `src/cli/testConnections.js`: Neo4j and Chroma connectivity plus write/query smoke tests.
- `src/cli/testLlm.js`: provider reachability and graph extraction smoke test.
- `src/cli/testParser.js`: local JSON extraction and graph normalization smoke test.
- `src/ingestion/ingestionService.js`: orchestrates extraction, normalization, graph persistence, and vector indexing.
- `src/ingestion/graphPayload.js`: normalizes LLM graph JSON into stable node and relationship payloads.
- `src/graph/neo4jGraphStore.js`: Neo4j persistence, graph expansion, and smoke test implementation.
- `src/vector/chromaVectorStore.js`: Chroma collections, node/relation documents, vector query, and smoke test implementation.
- `src/rag/hybridRagService.js`: vector entry-point retrieval, Neo4j expansion, context formatting, and final answer generation.
- `src/llm/geminiProvider.js` and `src/llm/ollamaProvider.js`: LLM provider adapters with the same small interface.
- `src/server/server.js`: Express web entry point for ask, ingest, and graph preview APIs.
- `src/server/public`: static split-screen KG preview and simulated chat UI.

## Setup

Install dependencies from the repo root:

```powershell
npm install
```

Run Neo4j and ChromaDB locally. Defaults are:

```text
Neo4j bolt: bolt://localhost:7687
Neo4j database: neo4j
Chroma: http://localhost:8000
```

Create a local POC config if needed:

```powershell
Copy-Item .\knowledgeGraphPOC\config.example.json .\knowledgeGraphPOC\config.json
```

Do not commit real API keys or local passwords. Prefer environment variables for secrets:

```powershell
$env:GEMINI_API_KEY="your-key"
$env:KG_LLM_PROVIDER="gemini"
```

## Configuration

`getConfig()` resolves values in this order:

1. Environment variable.
2. `knowledgeGraphPOC/config.json`.
3. Repo-root `config.json` for legacy Gemini `apiKey` and `model` only.
4. Hardcoded default.

Supported environment variables:

| Area | Variables |
| --- | --- |
| LLM | `KG_LLM_PROVIDER`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| Graph | `KG_GRAPH_PROVIDER`, `NEO4J_INSTANCE`, `NEO4J_URI`, `NEO4J_DATABASE`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` |
| Vector | `KG_VECTOR_PROVIDER`, `CHROMA_URL`, `CHROMA_TENANT`, `CHROMA_DATABASE`, `CHROMA_NODE_COLLECTION`, `CHROMA_RELATION_COLLECTION` |
| RAG | `KG_RAG_TOP_K`, `KG_RAG_DEPTH` |
| Prompts | `KG_EXTRACTION_PROMPT_PATH`, `KG_ANSWER_PROMPT_PATH`, `KG_CONTEXT_PROMPT_PATH` |

Only the `gemini`, `ollama`, `neo4j`, and `chroma` provider names are currently implemented.

## Commands

Test both databases:

```powershell
npm run kg:test-db
```

Test the selected LLM provider:

```powershell
npm run kg:test-llm
```

Run parser and normalizer smoke tests without external services:

```powershell
npm run kg:test-parser
```

Clear Chroma data:

```powershell
npm run kg:clear-chroma -- --yes
```

This calls Chroma `reset()` and then ensures the configured tenant/database exists again. If reset is disabled on the Chroma server, use the admin fallback for the configured tenant:

```powershell
npm run kg:clear-chroma -- --yes --delete-databases
```

Ingest with the hardcoded fallback sample:

```powershell
npm run kg:ingest
```

Ingest CLI text:

```powershell
npm run kg:ingest -- "EKYC Screen uses PAN Verification API."
```

Ingest from a file:

```powershell
npm run kg:ingest -- --file .\notes\input.txt
```

Ingest via runtime input:

```powershell
npm run kg:ingest -- --interactive
```

Ask with the hardcoded fallback question:

```powershell
npm run kg:ask
```

Ask a CLI question:

```powershell
npm run kg:ask -- "What does the EKYC screen use?"
```

Build and start the web UI:

```powershell
npm run kg:web
```

The web server defaults to:

```text
http://localhost:3000
```

Override the port with `KG_WEB_PORT` or `PORT`.

To rebuild only the browser bundle:

```powershell
npm run kg:web:build
```

Use a provider override for a single CLI run:

```powershell
npm run kg:ask -- --provider ollama "What does the EKYC screen use?"
```

## Input Handling

`readInput()` returns `{ text, options, source }`.

Priority order:

1. `--file` or `-f`: reads and trims the file contents.
2. Positional CLI text: joins all remaining args with spaces.
3. `--interactive` or `-i`: prompts on stdin.
4. Fallback text/question supplied by the caller.

`--provider <name>` is parsed by the shared input helper and passed only to the LLM provider factory.

## Graph Extraction Contract

The extraction prompt requires the LLM to return only JSON:

```json
{
  "nodes": [
    {
      "label": "Human readable name",
      "name": "lowercase_snake_case_name",
      "type": "concept",
      "description": "Short useful description, or empty string"
    }
  ],
  "relations": [
    {
      "sourceName": "source_node_name",
      "targetName": "target_node_name",
      "relation": "lowercase_snake_case_relation",
      "information": "One-line metadata describing the relation.",
      "description": "Longer description, or empty string"
    }
  ]
}
```

`extractJsonObject()` accepts raw JSON or fenced JSON and throws if no valid JSON object can be parsed.

`normalizeGraphPayload()` then:

- Converts node names, node types, and relation names to lowercase snake case.
- Creates node IDs as `node:<name>` when no ID is provided.
- Creates missing endpoint nodes for relations.
- Creates relationship IDs as `rel:<12-char-sha1>` when no ID is provided.
- Defaults missing descriptions to empty strings.
- Defaults missing relation `information` to a sentence derived from source label, relation, and target label.

## Neo4j Schema

Nodes use label `KnowledgeNode`.

Node properties:

- `id`
- `label`
- `name`
- `type`
- `description`
- `createdAt`
- `updatedAt`

Relationships use type `RELATES_TO`.

Relationship properties:

- `id`
- `sourceId`
- `targetId`
- `relation`
- `information`
- `description`
- `createdAt`
- `updatedAt`

`upsertGraph()` uses `MERGE` by node `id` and relationship `id`. Re-ingesting the same normalized fact updates properties and preserves `createdAt`.

`expandFromNodes(nodeIds, depth)` expands undirected `RELATES_TO` paths from entry nodes. Depth is clamped to `0..8` to avoid runaway traversals. The default configured depth is `4`.

`getGraphPreview(limit)` returns the newest capped full graph for the web UI. The default UI limit is `150`; the server clamps API limits to `1..500`. Relationships are included only when both endpoints are in the selected node set.

## Chroma Schema

Default collections:

- `kg_nodes`
- `kg_relationships`

Node documents concatenate:

```text
label
name
type
description
```

Node metadata:

- `kind: "node"`
- `label`
- `name`
- `type`

Relationship documents concatenate:

```text
relation
information
description
source:<sourceId>
target:<targetId>
```

Relationship metadata:

- `kind: "relation"`
- `sourceId`
- `targetId`
- `relation`

The current RAG flow queries only `kg_nodes`; relationship vectors are indexed for future retrieval paths.

## RAG Flow

`HybridRagService.answer({ query })` performs:

1. Query Chroma node collection with `topK` from config.
2. Use returned node IDs as entry points.
3. Expand Neo4j graph from those entry points to configured `depth`.
4. Format graph context as compact node and relation lists.
5. Ask the selected LLM to answer using only that graph context.

The result object includes:

- `answer`
- `entryNodes`
- `graph`
- `context`
- `depth`

## Web UI

The web UI is intentionally static and dependency-light. It is served by Express from `src/server/public`.

Layout:

- Desktop: graph preview uses roughly two thirds of the screen; simulated chat uses one third.
- Mobile: graph preview stacks above the chat panel.
- The graph preview uses Graphology + Sigma with force-layout positioning, draggable nodes, pan/zoom, hover focus, click-to-pin focus, and compact relationship labels.
- The chat panel has one text area and two buttons: `Ask` and `Ingest`.
- Chat messages are local UI state only. There is no persisted session and no conversational memory passed to the LLM.
- `src/server/public/app.js` is the source file. `npm run kg:web:build` bundles it to `app.bundle.js`, which is intentionally ignored by git.

API endpoints:

- `GET /api/graph?limit=150`: returns `{ nodes, relations, limit }`.
- `POST /api/ask`: accepts `{ "text": "question" }` and returns `{ answer, entryNodes, graph, depth }`.
- `POST /api/ingest`: accepts `{ "text": "source text" }` and returns `{ nodes, relations, triplets, graph }`.
- Errors return `{ error: "message" }`.

Ingest responses include `triplets` formatted as:

```json
{
  "sourceId": "node:source",
  "sourceLabel": "Source",
  "relation": "uses",
  "targetId": "node:target",
  "targetLabel": "Target",
  "information": "Source uses Target."
}
```

## Provider Interfaces

LLM providers should implement:

- `generateText({ systemPrompt, prompt })`
- `extractGraph({ text, systemPrompt })`
- `generateAnswer({ systemPrompt, context, query })`

Graph stores should implement the methods currently used by CLIs and services:

- `verifyConnectivity()`
- `upsertGraph(graphPayload)`
- `expandFromNodes(nodeIds, depth)`
- `getGraphPreview(limit)`
- `smokeTest()`
- `close()`

Vector stores should implement:

- `verifyConnectivity()`
- `upsertGraphIndex(graphPayload)`
- `queryNodes(query, topK)`
- `smokeTest()`

To add a provider, create the adapter and update the relevant `providerFactory.js`.

## Agent Notes

- This is a POC, not a hardened service. There is no migration system, no delete/update reconciliation for removed facts, and no automated unit test framework beyond smoke-test scripts.
- `config.json` may contain local secrets. Inspect `config.example.json` for shape, not private values.
- Prompt behavior is part of the application contract. Update prompt files and README together when changing extraction or answer semantics.
- Chroma retrieval depends on its configured embedding implementation. If query quality changes, check collection contents and embedding defaults before changing graph expansion code.
- Neo4j relationship type is always `RELATES_TO`; the semantic relation is stored in the `relation` property.
- `source` is passed into `upsertGraph()` today but is not persisted by `Neo4jGraphStore`.
- The fallback ingestion text in `src/cli/ingest.js` is intentionally large and domain-specific. It is sample data, not a schema definition.
