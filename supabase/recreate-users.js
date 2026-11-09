/**
 * SIVAX — Recreate seed users with proper auth
 *
 * Run: node supabase/recreate-users.js
 *
 * User data is read from supabase/users.json (gitignored).
 * See supabase/users-template.json for the expected format.
 * Passwords are prompted interactively or read from SEED_PASSWORD_N env vars.
 *
 * This script:
 * 1. Deletes existing profiles from public.users
 * 2. Deletes existing auth users (if any)
 * 3. Recreates users via Supabase admin API (proper bcrypt hashing)
 * 4. Updates profiles with correct role
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const envVars = {};
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) envVars[match[1]] = match[2];
});

const supabase = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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

async function recreateUsers() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Collect passwords first
  const usersWithPasswords = [];
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
    usersWithPasswords.push({ ...u, password });
  }

  rl.close();

  // Step 1: Delete existing profiles from public.users
  console.log("=== Step 1: Cleaning up existing profiles ===");
  for (const u of usersWithPasswords) {
    const { error } = await supabase.from("users").delete().eq("email", u.email);
    if (error) {
      console.error(`  Failed to delete profile for ${u.email}: ${error.message}`);
    } else {
      console.log(`  Deleted profile: ${u.email}`);
    }
  }

  // Step 2: Delete existing auth users (search by email)
  console.log("\n=== Step 2: Cleaning up existing auth users ===");
  for (const u of usersWithPasswords) {
    const { data: listData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existingUser = listData?.users?.find((x) => x.email === u.email);
    if (existingUser) {
      const { error: delError } = await supabase.auth.admin.deleteUser(existingUser.id);
      if (delError) {
        console.error(`  Failed to delete auth user ${u.email}: ${delError.message}`);
      } else {
        console.log(`  Deleted auth user: ${u.email}`);
      }
    } else {
      console.log(`  No auth user found for: ${u.email}`);
    }
  }

  // Step 3: Create users via admin API
  console.log("\n=== Step 3: Creating users via admin API ===");
  for (const u of usersWithPasswords) {
    console.log(`Creating: ${u.email}...`);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: {
        full_name: u.full_name,
        organization: u.organization,
      },
    });

    if (authError) {
      console.error(`  Failed: ${JSON.stringify(authError)}`);
      continue;
    }

    console.log(`  Auth user created: ${authData.user.id}`);

    // Step 4: Update profile with role
    const { error: profileError } = await supabase
      .from("users")
      .update({ role: u.role, full_name: u.full_name, organization: u.organization })
      .eq("id", authData.user.id);

    if (profileError) {
      const { error: insertError } = await supabase
        .from("users")
        .insert({
          id: authData.user.id,
          email: u.email,
          full_name: u.full_name,
          role: u.role,
          organization: u.organization,
        });
      if (insertError) {
        console.error(`  Failed to create profile: ${insertError.message}`);
      } else {
        console.log(`  Profile created with role: ${u.role}`);
      }
    } else {
      console.log(`  Profile updated with role: ${u.role}`);
    }
  }

  // Verify
  console.log("\n=== Verification ===");
  const { data: users, error } = await supabase
    .from("users")
    .select("email, full_name, role, organization")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch users:", error.message);
  } else {
    users.forEach((u) => {
      console.log(`  ${u.email} | ${u.full_name} | ${u.role} | ${u.organization}`);
    });
  }
}

recreateUsers().catch(console.error);
