import fs from "fs";
import axios from "axios";
import FormData from "form-data";

export interface Metadata {
  meeting_title: string;
  meeting_type: string;
  language: string;
  participants: string;
}

export async function uploadMeeting(filePath: string, metadata: Metadata) {
  const uploadUrl = process.env.UPLOAD_MEETING_URL;
  if (!uploadUrl) {
    throw new Error("UPLOAD_MEETING_URL environment variable is not set");
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const secret = process.env.BOT_INTERNAL_SECRET;

  if (!token && !secret) {
    throw new Error("Neither SUPABASE_ACCESS_TOKEN nor BOT_INTERNAL_SECRET is provided");
  }

  const formData = new FormData();
  formData.append("audio", fs.createReadStream(filePath));
  formData.append("meeting_title", metadata.meeting_title || "Unknown Meeting");
  formData.append("meeting_type", metadata.meeting_type || "meeting");
  formData.append("language", metadata.language || "en");
  
  let participantsString = metadata.participants || "";
  if (Array.isArray(metadata.participants)) {
      participantsString = metadata.participants.join(", ");
  }
  formData.append("participants", participantsString);

  try {
    const headers: Record<string, string> = { ...formData.getHeaders() };
    
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else if (secret) {
      headers["X-Internal-Auth"] = secret;
    }

    const response = await axios.post(uploadUrl, formData, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log(`[Upload] Upload successful: ${response.status}`, response.data);
    return response.data;
  } catch (error: any) {
    console.error("[Upload Error]: Uploading meeting failed", error.message);
    if (error.response) {
      console.error("[Upload Error]: Response body:", error.response.data);
    }
    throw error;
  }
}