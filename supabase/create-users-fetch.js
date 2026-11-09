/**
 * SIVAX — Create users via direct fetch (better error messages)
 *
 * Usage: node supabase/create-users-fetch.js
 *
 * User data is read from supabase/users.json (gitignored).
 * See supabase/users-template.json for the expected format.
 * Passwords are prompted interactively or read from SEED_PASSWORD_N env vars.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const envVars = {};
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) envVars[match[1]] = match[2];
});

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

const usersFile = path.join(__dirname, "users.json");
if (!fs.existsSync(usersFile)) {
  console.error("Error: supabase/users.json not found.");
  console.error("Copy supabase/users-template.json to supabase/users.json and fill in the user data.");
  process.exit(1);
}

const SEED_USERS = JSON.parse(fs.readFileSync(usersFile, "utf8"));
if (!Array.isArray(SEED_USERS) || SEED_USERS.length === 0) {
  console.error("Error: supabase/users.json must contain a non-empty array of users.");
  process.exit(1);
}

function askPassword(rl, email) {
  return new Promise((resolve) => {
    rl.question(`Enter password for ${email}: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function createUser(u, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "apikey": SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name, organization: u.organization },
    }),
  });

  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < SEED_USERS.length; i++) {
    const u = SEED_USERS[i];
    const envKey = `SEED_PASSWORD_${i + 1}`;
    let password = envVars[envKey] || process.env[envKey];
    if (!password) {
      password = await askPassword(rl, u.email);
    }
    if (!password || password.length < 8) {
      console.error(`Skipping ${u.email}: password must be at least 8 characters.`);
      continue;
    }

    console.log(`\n--- ${u.email} ---`);
    const { status, data } = await createUser(u, password);
    console.log(`Status: ${status}`);
    console.log(`Response:`, JSON.stringify(data, null, 2));
  }

  rl.close();
}

main().catch(console.error);
