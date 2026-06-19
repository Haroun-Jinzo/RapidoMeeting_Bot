import fs from "fs";
import axios from "axios";
import FormData from "form-data";

export interface Metadata {
  meeting_title: string;
  meeting_type: string;
  language: string;
  participants: string;
  user_instructions?: string;
  userId?: string;
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

    // Prefer an internal secret header for service-to-service calls when available
    if (secret) {
      headers["X-Internal-Auth"] = secret;
      if (metadata.userId) {
        headers["x-internal-user-id"] = metadata.userId;
      }
    } else if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    
    console.log(`[Upload] Starting upload to ${uploadUrl}...`);
    const response = await axios.post(uploadUrl, formData, {
      headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 300000,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const sessionId = response.data?.session_id || response.data?.sessionId;
    console.log(
      `[Upload] Upload accepted with status ${response.status}` +
        (sessionId ? ` — session ${sessionId}` : ""),
    );
    return response.data;
  } catch (error: any) {
    console.error("[Upload Error]:", error?.message || error);
    if (error.response) {
      console.error("[Upload Error Response]:", error.response.data);
    }
    // Do NOT throw: ensure the bot runner finishes the job even if Main Backend fails.
    return {
      error: error?.message || String(error),
      status: error?.response?.status,
      response: error?.response?.data,
    };
  }
}