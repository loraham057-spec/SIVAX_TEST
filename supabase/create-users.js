/**
 * SIVAX — Create users one by one with detailed error handling
 *
 * Usage: node supabase/create-users.js
 *
 * User data is read from supabase/users.json (gitignored).
 * See supabase/users-template.json for the expected format.
 * Passwords are prompted interactively or read from SEED_PASSWORD_N env vars.
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

async function createUsers() {
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

    console.log(`\n--- Creating: ${u.email} ---`);

    // First, try to sign in to check if user exists in auth
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: u.email,
      password,
    });

    if (signInData?.user) {
      console.log(`  User already exists and password works! ID: ${signInData.user.id}`);
      // Update profile
      await supabase.from("users").upsert({
        id: signInData.user.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        organization: u.organization,
      });
      console.log(`  Profile upserted.`);
      // Sign out
      await supabase.auth.signOut();
      continue;
    }

    // Try to create
    console.log(`  Creating new user...`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
    });

    if (error) {
      console.error(`  Error: ${error.name} | ${error.message} | status: ${error.status}`);
      console.error(`  Full:`, JSON.stringify(error, null, 2));

      // If user might exist but with wrong password, try to list all users
      const { data: allUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
      const found = allUsers?.users?.find((x) => x.email === u.email);
      if (found) {
        console.log(`  Found existing user via listUsers: ${found.id}`);
        // Update password
        const { error: pwdError } = await supabase.auth.admin.updateUserById(found.id, {
          password,
        });
        if (pwdError) {
          console.error(`  Failed to update password: ${pwdError.message}`);
        } else {
          console.log(`  Password updated!`);
          await supabase.from("users").upsert({
            id: found.id,
            email: u.email,
            full_name: u.full_name,
            role: u.role,
            organization: u.organization,
          });
        }
      }
      continue;
    }

    console.log(`  Created: ${data.user.id}`);

    // Update profile
    const { error: profError } = await supabase
      .from("users")
      .upsert({
        id: data.user.id,
        email: u.email,
        full_name: u.full_name,
        role: u.role,
        organization: u.organization,
      });

    if (profError) {
      console.error(`  Profile error: ${profError.message}`);
    } else {
      console.log(`  Profile created.`);
    }
  }

  rl.close();

  // Verify
  console.log("\n=== Final verification ===");
  const { data: users } = await supabase.from("users").select("email, full_name, role").order("created_at");
  console.log("Profiles:", users);
}

createUsers().catch(console.error);
