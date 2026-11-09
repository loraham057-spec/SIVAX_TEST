/**
 * SIVAX — Reset passwords for seed users
 *
 * Usage: node supabase/reset-passwords.js
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
    rl.question(`Enter new password for ${email}: `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function resetPasswords() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < SEED_USERS.length; i++) {
    const email = SEED_USERS[i].email;
    const envKey = `SEED_PASSWORD_${i + 1}`;
    let password = envVars[envKey] || process.env[envKey];
    if (!password) {
      password = await askPassword(rl, email);
    }
    if (!password || password.length < 8) {
      console.error(`Skipping ${email}: password must be at least 8 characters.`);
      continue;
    }

    console.log(`Resetting password for: ${email}...`);

    const { data: userList, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error(`  Failed to list users: ${listError.message}`);
      continue;
    }

    const user = userList.users.find((x) => x.email === email);
    if (!user) {
      console.log(`  User not found in auth, creating...`);
      const { error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError) {
        console.error(`  Failed to create: ${createError.message}`);
      } else {
        console.log(`  Created with proper password.`);
      }
      continue;
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password,
    });

    if (updateError) {
      console.error(`  Failed to reset password: ${updateError.message}`);
    } else {
      console.log(`  Password reset successfully.`);
    }
  }

  rl.close();
}

resetPasswords().catch(console.error);
