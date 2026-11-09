/**
 * POST /api/assistant/transcribe
 *
 * Receives an audio blob (multipart/form-data) and transcribes it
 * using the ElevenLabs Speech-to-Text API.
 *
 * Requires ELEVENLABS_API_KEY in environment variables.
 * Returns: { text: string }
 */

import { apiError } from "../../_lib/proxy";
import { getSetting } from "@/lib/settings";

export async function POST(request: Request) {
  const apiKey = await getSetting("elevenlabs_api_key");
  if (!apiKey) {
    return apiError("ELEVENLABS_API_KEY is not configured", 500);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiError("Invalid form data");
  }

  const audioFile = formData.get("audio");
  if (!audioFile || !(audioFile instanceof File)) {
    return apiError("Missing 'audio' file in form data");
  }

  try {
    // ElevenLabs Scribe v1 endpoint for speech-to-text.
    const elevenFormData = new FormData();
    elevenFormData.append("file", audioFile, audioFile.name || "recording.webm");
    elevenFormData.append("model_id", "scribe_v1");

    // Determine language from form data if provided.
    const language = formData.get("language") as string | null;
    if (language) {
      elevenFormData.append("language_code", language);
    }

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: elevenFormData,
    });

    if (!res.ok) {
      const error = await res.text();
      return apiError(`ElevenLabs API error: ${error}`, 500);
    }

    const data = await res.json();
    // ElevenLabs returns { text: "..." } in the response.
    const text = data.text ?? data.transcript ?? "";

    return Response.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription error";
    return apiError(message, 500);
  }
}
