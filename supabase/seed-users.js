/**
 * SIVAX — Seed Initial Admin Users
 *
 * Run: node supabase/seed-users.js
 *
 * User data is read from supabase/users.json (gitignored).
 * See supabase/users-template.json for the expected format.
 * Passwords are prompted interactively or read from SEED_PASSWORD_N env vars.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

// Load .env.local
const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const envVars = {};
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) envVars[match[1]] = match[2];
});

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

async function seed() {
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

    console.log(`Creating user: ${u.email}...`);

    // Check if user already exists
    const { data: existing } = await supabase
      .from("users")
      .select("id, email")
      .eq("email", u.email)
      .maybeSingle();

    if (existing) {
      console.log(`  User exists, updating profile...`);
      const { error: updateError } = await supabase
        .from("users")
        .update({ role: u.role, full_name: u.full_name, organization: u.organization })
        .eq("id", existing.id);

      if (updateError) {
        console.error(`  Failed to update profile: ${updateError.message}`);
      } else {
        console.log(`  Profile updated.`);
      }
      continue;
    }

    // Create auth user via admin API (proper bcrypt hashing)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: u.full_name,
        role: u.role,
        organization: u.organization,
      },
    });

    if (authError) {
      console.error(`  Failed to create auth user: ${authError.message}`);
      continue;
    }

    console.log(`  Auth user created: ${authData.user.id}`);

    const { error: profileError } = await supabase
      .from("users")
      .update({ role: u.role, full_name: u.full_name, organization: u.organization })
      .eq("id", authData.user.id);

    if (profileError) {
      console.error(`  Failed to update profile: ${profileError.message}`);
    } else {
      console.log(`  Profile updated with role: ${u.role}`);
    }
  }

  rl.close();

  // Verify
  const { data: users, error } = await supabase
    .from("users")
    .select("email, full_name, role, organization")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch users:", error.message);
  } else {
    console.log("\n=== Users in database ===");
    users.forEach((u) => {
      console.log(`  ${u.email} | ${u.full_name} | ${u.role} | ${u.organization}`);
    });
  }
}

seed().catch(console.error);
