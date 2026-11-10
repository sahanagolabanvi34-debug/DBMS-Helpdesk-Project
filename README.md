# Enterprise Multi-Tenant Helpdesk Portal with Native Vector Search & RAG

A production-grade, multi-tenant customer support platform built with PostgreSQL, Next.js (App Router), TypeScript, pgvector, and Google Gemini[cite: 2].

Instead of treating the database as a passive data store, this architecture enforces tenant data isolation, semi-structured document indexing, transactional audit logging, dynamic performance analytics, and dense vector similarity search directly within the PostgreSQL database engine.

---

## Key Architectural Highlights

* Database-Enforced Multi-Tenancy (Row-Level Security): Tenant isolation is enforced at the PostgreSQL kernel level using ENABLE ROW LEVEL SECURITY and transaction-scoped configuration variables (set_config('app.tenant_id', ..., true)). Applications cannot accidentally leak cross-tenant data even if a query omits tenant filtering.
* Database-Native Vector Search (pgvector + HNSW): Knowledge base embeddings (384-dimensional dense vectors) are stored natively and indexed using Hierarchical Navigable Small World (HNSW) graphs with cosine distance metrics (vector_cosine_ops), executing sub-second O(log N) Approximate Nearest Neighbor (ANN) search.
* Hybrid Relational + Document Architecture (3NF + NoSQL): Core business entities follow strict Third Normal Form (3NF) relational constraints, while dynamic telemetry, browser data, and custom support attributes reside in a JSONB document column indexed with Generalized Inverted Indexes (GIN).
* Automated Audit Logging via Triggers: Changes to ticket statuses or priorities automatically generate immutable event records in ticket_events via an internal database trigger (trg_log_ticket_event), eliminating reliance on application-layer logging logic.
* In-Engine Analytics via SQL Views: The v_agent_workload view aggregates open, in-progress, and resolved ticket counts per agent on the database engine, returning pre-calculated summaries to the dashboard while respecting caller RLS policies.
* Stateless JWT Authentication: User authentication packages identity and tenant claims into a signed JSON Web Token, which the API unlocks per transaction without requiring database session table reads.

---

## System Architecture

+-------------------------------------------------------------+
|                    Next.js Frontend (UI)                    |
|    - Customer / Agent / Admin Dashboard                     |
|    - Ticket Submission & Workload Visualization             |
|    - AI Support Assistant (Interactive Chat Widget)         |
+------------------------------+------------------------------+
                               | HTTPS / JSON
                               v
+-------------------------------------------------------------+
|                 Next.js API Routes (Backend)                |
|    - Session Verification (Stateless JWT Claims)            |
|    - Embedding Pipeline (@xenova/transformers MiniLM)       |
|    - Context Grounding & Gemini 2.5 Flash Synthesis         |
+------------------------------+------------------------------+
                               | Connection Pool (Transaction-Scoped)
                               v
+-------------------------------------------------------------+
|                PostgreSQL 16 + pgvector (DBMS)              |
|  +-------------------------------------------------------+  |
|  | Security: Row-Level Security (app.tenant_id)          |  |
|  +-------------------------------------------------------+  |
|  | Vector Search: HNSW Cosine Index (idx_kb_hnsw)        |  |
|  +-------------------------------------------------------+  |
|  | Semi-Structured Store: JSONB + GIN Index              |  |
|  +-------------------------------------------------------+  |
|  | Automation: Event Triggers (trg_log_ticket_event)     |  |
|  +-------------------------------------------------------+  |
|  | Analytics: Security-Invoking Views (v_agent_workload) |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+

---

## Conceptual ER Diagram

    +-------------------------+
    |         TENANT          |
    |  (PK: tenant_id)        |
    +------------+------------+
                 | 1
                 |
       +---------+-----------------------+------------------------+
       | N                               | N                      | N
+------v------------------+   +----------v-------------+   +------v-----------------+
|          USER           |   |         TICKET         |   |       KB_ARTICLE       |
|  (PK: user_id)          |   |  (PK: ticket_id)       |   |  (PK: article_id)      |
|  (FK: tenant_id)        |   |  (FK: tenant_id)       |   |  (FK: tenant_id)       |
+------v------------------+   |  (FK: customer_id)     |   |  (Attr: embedding)     |
       | 1                    |  (FK: agent_id)        |   +------------------------+
       |                      |  (Attr: metadata JSONB)|
       |                      +----------+-------------+
       | N                               | 1
       |                                 | N
       |                      +----------v-------------+
       +--------------------->|      TICKET_EVENT      |
                              |  (PK: event_id)        |
                              |  (FK: ticket_id)       |
                              |  (FK: actor_id)        |
                              +------------------------+

---

## Relational Schema Specifications

### 1. tenants
* tenant_id (UUID, Primary Key, Default: gen_random_uuid())
* name (VARCHAR(255), NOT NULL)
* created_at (TIMESTAMPTZ, Default: NOW())

### 2. users
* user_id (UUID, Primary Key, Default: gen_random_uuid())
* tenant_id (UUID, Foreign Key -> tenants(tenant_id) ON DELETE CASCADE)
* email (VARCHAR(255), NOT NULL, UNIQUE per tenant)
* password_hash (TEXT, NOT NULL)
* role (VARCHAR(50), CHECK role IN ('customer', 'agent', 'admin'))
* created_at (TIMESTAMPTZ, Default: NOW())

### 3. tickets
* ticket_id (UUID, Primary Key, Default: gen_random_uuid())
* tenant_id (UUID, Foreign Key -> tenants(tenant_id) ON DELETE CASCADE)
* customer_id (UUID, Foreign Key -> users(user_id))
* agent_id (UUID, Nullable, Foreign Key -> users(user_id))
* subject (VARCHAR(255), NOT NULL)
* description (TEXT, NOT NULL)
* status (VARCHAR(50), CHECK status IN ('open', 'in_progress', 'resolved', 'closed'))
* priority (VARCHAR(50), CHECK priority IN ('low', 'medium', 'high', 'urgent'))
* metadata (JSONB, Default: '{}'::jsonb, Indexed with GIN)
* created_at (TIMESTAMPTZ, Default: NOW())

### 4. kb_articles
* article_id (UUID, Primary Key, Default: gen_random_uuid())
* tenant_id (UUID, Foreign Key -> tenants(tenant_id) ON DELETE CASCADE)
* title (VARCHAR(255), NOT NULL)
* body (TEXT, NOT NULL)
* embedding (VECTOR(384), Indexed with HNSW Cosine Ops)
* created_at (TIMESTAMPTZ, Default: NOW())

### 5. ticket_events
* event_id (UUID, Primary Key, Default: gen_random_uuid())
* tenant_id (UUID, Foreign Key -> tenants(tenant_id) ON DELETE CASCADE)
* ticket_id (UUID, Foreign Key -> tickets(ticket_id) ON DELETE CASCADE)
* actor_id (UUID, Foreign Key -> users(user_id))
* event_type (VARCHAR(100), NOT NULL)
* old_value (TEXT)
* new_value (TEXT)
* created_at (TIMESTAMPTZ, Default: NOW())

---

## Database Mechanics & Implementation Details

### Row-Level Security Policy
Each table enforces data isolation using the following pattern:

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON tickets
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID);

### Transaction-Scoped Session Setting
Every incoming database connection executes within an atomic transaction:

BEGIN;
SELECT set_config('app.tenant_id', $1, true);
-- Queries run here under active RLS
COMMIT;

Setting the third parameter (is_local) to true guarantees that the variable clears upon COMMIT or ROLLBACK, preventing connection-pool contamination.

### Native Vector HNSW Indexing
Vector similarity lookups use an Approximate Nearest Neighbor graph:

CREATE INDEX idx_kb_hnsw ON kb_articles
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

Retrieval Query:

SELECT title, body, (1 - (embedding <=> $1::vector)) AS similarity
FROM kb_articles
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1::vector ASC
LIMIT 3;

### Dynamic Workload View

CREATE OR REPLACE VIEW v_agent_workload
WITH (security_invoker = true) AS
SELECT 
    u.user_id AS agent_id,
    u.email,
    COUNT(t.ticket_id) FILTER (WHERE t.status = 'open') AS open_tickets,
    COUNT(t.ticket_id) FILTER (WHERE t.status = 'in_progress') AS in_progress,
    COUNT(t.ticket_id) FILTER (WHERE t.status = 'resolved') AS resolved
FROM users u
LEFT JOIN tickets t ON u.user_id = t.agent_id
WHERE u.role IN ('agent', 'admin')
GROUP BY u.user_id, u.email;

---

## Local Setup & Run Guide

### 1. Prerequisites
* Docker Desktop installed and running.
* Node.js (v18 or higher).
* Google Gemini API Key.

### 2. Start PostgreSQL Container
```powershell
docker run -d `
  --name helpdesk_db `
  -e POSTGRES_USER=helpdesk_owner `
  -e POSTGRES_PASSWORD=owner_secure_password `
  -e POSTGRES_DB=helpdesk `
  -p 5432:5432 `
  pgvector/pgvector:pg16
