export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
  verified_languages?: Array<{
    language?: string;
    locale?: string;
    accent?: string;
    preview_url?: string;
  }>;
}

export interface ElevenLabsUsage {
  character_count: number;
  character_limit: number;
}

export class ElevenLabsService {
  private apiKey: string;
  private baseUrl = "https://api.elevenlabs.io/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async speechToText(audioBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("file", audioBlob, getAudioFileName(audioBlob));
    formData.append("model_id", "scribe_v2");

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: formData,
    });

    if (!response.ok) throw new Error(await buildElevenLabsError("STT failed", response));
    const data = (await response.json()) as { text?: string };
    return data.text ?? "";
  }

  async textToSpeech(text: string, voiceId: string): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
    return response.blob();
  }

  async cloneVoice(name: string, audioBlobs: Blob[]): Promise<{ voice_id: string }> {
    const formData = new FormData();
    formData.append("name", name);
    audioBlobs.forEach((blob, i) => {
      formData.append("files", blob, getAudioFileName(blob, i));
    });

    const response = await fetch(`${this.baseUrl}/voices/add`, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey },
      body: formData,
    });

    if (!response.ok) throw new Error(await buildElevenLabsError("Clone failed", response));
    return response.json() as Promise<{ voice_id: string }>;
  }

  async listVoices({ showLegacy = true }: { showLegacy?: boolean } = {}): Promise<
    ElevenLabsVoice[]
  > {
    const url = new URL(`${this.baseUrl}/voices`);
    if (showLegacy) url.searchParams.set("show_legacy", "true");

    const response = await fetch(url, {
      headers: { "xi-api-key": this.apiKey },
    });

    if (!response.ok) throw new Error(`List voices failed: ${response.status}`);
    const data = (await response.json()) as { voices: ElevenLabsVoice[] };
    return data.voices;
  }

  async getUsage(): Promise<ElevenLabsUsage> {
    const response = await fetch(`${this.baseUrl}/user/subscription`, {
      headers: { "xi-api-key": this.apiKey },
    });

    if (!response.ok) throw new Error(`Usage failed: ${response.status}`);
    return response.json() as Promise<ElevenLabsUsage>;
  }

  async validateKey(): Promise<boolean> {
    try {
      await this.getUsage();
      return true;
    } catch {
      return false;
    }
  }
}

function getAudioFileName(audioBlob: Blob, index?: number): string {
  const suffix = typeof index === "number" ? `_${index + 1}` : "";
  if (audioBlob.type.includes("mp4")) return `recording${suffix}.mp4`;
  if (audioBlob.type.includes("wav")) return `recording${suffix}.wav`;
  if (audioBlob.type.includes("mpeg") || audioBlob.type.includes("mp3")) {
    return `recording${suffix}.mp3`;
  }
  return `recording${suffix}.webm`;
}

async function buildElevenLabsError(prefix: string, response: Response): Promise<string> {
  const detail = await response.text().catch(() => "");
  return detail ? `${prefix}: ${response.status} ${detail}` : `${prefix}: ${response.status}`;
}
