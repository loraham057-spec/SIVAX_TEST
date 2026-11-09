/**
 * SIVAX — Debug Supabase connection
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const envFile = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const envVars = {};
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) envVars[match[1]] = match[2];
});

console.log("SUPABASE_URL:", envVars.NEXT_PUBLIC_SUPABASE_URL);
console.log("SERVICE_KEY length:", envVars.SUPABASE_SERVICE_ROLE_KEY?.length);
console.log("SERVICE_KEY starts with:", envVars.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20));

const supabase = createClient(
  envVars.NEXT_PUBLIC_SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function debug() {
  // Test 1: List users
  console.log("\n=== listUsers ===");
  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (listError) {
    console.error("Error:", JSON.stringify(listError));
  } else {
    console.log("Total users:", listData.users?.length);
    listData.users?.forEach((u) => {
      console.log(`  ${u.email} | ${u.id} | created: ${u.created_at}`);
    });
  }

  // Test 2: Query public.users
  console.log("\n=== public.users ===");
  const { data: profiles, error: profError } = await supabase
    .from("users")
    .select("id, email, role, full_name")
    .limit(10);
  if (profError) {
    console.error("Error:", profError.message);
  } else {
    console.log("Profiles:", profiles?.length);
    profiles?.forEach((p) => console.log(`  ${p.email} | ${p.id} | ${p.role}`));
  }

  // Test 3: Try creating a single test user (cleaned up after)
  console.log("\n=== createUser test ===");
  const testEmail = `test-${Date.now()}@debug.local`;
  const testPassword = `DebugTest${Date.now()}!`;
  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  if (createError) {
    console.error("Error:", JSON.stringify(createError, null, 2));
  } else {
    console.log("Created:", createData.user.id);
    // Clean up
    await supabase.auth.admin.deleteUser(createData.user.id);
    console.log("Cleaned up test user.");
  }
}

debug().catch(console.error);
