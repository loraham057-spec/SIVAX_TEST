import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getSetting } from "@/lib/settings";

export async function POST(request: NextRequest) {
  const apiKey = await getSetting("resend_api_key");
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 503 });
  }
  const resend = new Resend(apiKey);

  const { to } = await request.json();

  if (!to) {
    return NextResponse.json({ error: "Missing 'to' field" }, { status: 400 });
  }

  const { data, error } = await resend.emails.send({
    from: "SIVAX Notifications <notification@sivax.health>",
    to,
    subject: "SIVAX — Email Test",
    html: "<h1>Test email from SIVAX</h1><p>If you received this, email notifications are working.</p>",
  });

  if (error) {
    return NextResponse.json({ error: error.message, details: error }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data?.id });
}
