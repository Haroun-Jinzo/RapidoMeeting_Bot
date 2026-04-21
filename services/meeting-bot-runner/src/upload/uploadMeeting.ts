import fs from "fs";
import axios from "axios";
import FormData from "form-data";

export interface Metadata {
  meeting_title: string;
  meeting_type: string;
  language: string;
  participants: string;
  user_instructions?: string;
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
  if (metadata.user_instructions) {
    formData.append("user_instructions", metadata.user_instructions);
  }
  
  let participantsString = metadata.participants || "";
  if (Array.isArray(metadata.participants)) {
      participantsString = metadata.participants.join(", ");
  }
  formData.append("participants", participantsString);

  try {
    const headers: Record<string, string> = { ...formData.getHeaders() };
    
    // Crucial for some express/multer configurations to not hang
    headers["Content-Length"] = await new Promise((resolve, reject) => {
      formData.getLength((err, length) => {
        if (err) reject(err);
        else resolve(length.toString());
      });
    });

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else if (secret) {
      headers["X-Internal-Auth"] = secret;
    }

    console.log(`[Upload] Starting upload to ${uploadUrl}...`);
    const response = await axios.post(uploadUrl, formData, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000, // 30 seconds timeout to catch hanging requests
    });
    console.log(`[Upload] Upload completed successfully with status ${response.status}`);
    return response.data;
  } catch (error: any) {
    console.error("[Upload Error]:", error?.message || error);
    if (error.response) {
      console.error("[Upload Error Response]:", error.response.data);
    }
    throw error;
  }
}