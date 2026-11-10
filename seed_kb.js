const { Pool } = require('pg');
const { pipeline } = require('@xenova/transformers');

const pool = new Pool({
  connectionString: 'postgresql://helpdesk_owner:owner_secure_password@localhost:5432/helpdesk',
});

async function seedKB() {
  console.log('Loading embedding model...');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const articles = [
    {
      title: 'Google Workspace SSO Login Troubleshooting',
      body: 'If users encounter HTTP 500 or authentication errors during single sign-on, verify that the SAML ACS URL is properly configured in the Google Admin console and certificates match.',
    },
    {
      title: 'Billing and Invoicing FAQ',
      body: 'Invoices are generated on the 1st of every month. For plan upgrades from Pro to Enterprise, prorated charges apply immediately to your credit card.',
    },
    {
      title: 'Password Reset and Account Recovery',
      body: 'To reset your account password, visit the login page and click Forgot Password. A secure 6-digit verification code will be sent to your primary company email address.',
    },
  ];

  const tenantId = 'a0000000-0000-0000-0000-000000000001'; // Acme Corp

  for (const art of articles) {
    const text = `${art.title} ${art.body}`;
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const vectorStr = `[${Array.from(output.data).join(',')}]`;

    await pool.query(
      `INSERT INTO kb_articles (tenant_id, title, body, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [tenantId, art.title, art.body, vectorStr]
    );
    console.log(`Inserted: "${art.title}"`);
  }

  console.log('KB seeding completed successfully!');
  await pool.end();
}

seedKB().catch((err) => {
  console.error(err);
  process.exit(1);
});
