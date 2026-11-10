const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: 'postgresql://helpdesk_owner:owner_secure_password@localhost:5432/helpdesk',
});

async function seed() {
  const hash = await bcrypt.hash('Password123!', 10);
  console.log('Generated fresh bcrypt hash:', hash);

  await pool.query('TRUNCATE TABLE ticket_events, tickets, kb_articles, users, tenants CASCADE;');

  // Insert Tenants
  await pool.query(`
    INSERT INTO tenants (tenant_id, slug, name, plan_type) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'acme', 'Acme Corp', 'enterprise'),
    ('b0000000-0000-0000-0000-000000000002', 'beta', 'Beta Ltd', 'pro');
  `);

  // Insert Users
  await pool.query(`
    INSERT INTO users (user_id, tenant_id, email, role, password_hash) VALUES
    ('a1111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin@acme.com', 'admin', $1),
    ('a2222222-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'agent@acme.com', 'agent', $1),
    ('a3333333-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'customer@acme.com', 'customer', $1),
    ('b1111111-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'admin@beta.com', 'admin', $1),
    ('b2222222-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'customer@beta.com', 'customer', $1);
  `, [hash]);

  // Insert Sample Tickets
  await pool.query(`
    INSERT INTO tickets (ticket_id, tenant_id, customer_id, agent_id, subject, description, status, priority) VALUES
    ('c1111111-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a3333333-0000-0000-0000-000000000003', 'a2222222-0000-0000-0000-000000000002', 'Unable to login with SSO', 'Getting 500 error when clicking Google SSO button', 'in_progress', 'high'),
    ('c2222222-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a3333333-0000-0000-0000-000000000003', NULL, 'Invoice discrepancy for March', 'Charged $499 instead of $199 plan price', 'open', 'medium'),
    ('c3333333-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'b2222222-0000-0000-0000-000000000002', NULL, 'Beta secret feature request', 'This ticket must NEVER show up to Acme users', 'open', 'low');
  `);

  console.log('Seeding completed successfully!');
  await pool.end();
}

seed().catch(err => { console.error(err); process.exit(1); });
