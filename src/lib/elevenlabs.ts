export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
}

export interface ElevenLabsUsage {
  character_count: number;
  character_limit: number;
}

export class ElevenLabsService {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async speechToText(audioBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('audio', audioBlob);
    formData.append('model_id', 'scribe_v1');

    const response = await fetch(`${this.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) throw new Error(`STT failed: ${response.status}`);
    const data = await response.json() as { text: string };
    return data.text;
  }

  async textToSpeech(text: string, voiceId: string = 'pNInz6obpgDQGcFmaJgB'): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
    return response.blob();
  }

  async cloneVoice(name: string, audioBlobs: Blob[]): Promise<{ voice_id: string }> {
    const formData = new FormData();
    formData.append('name', name);
    audioBlobs.forEach((blob, i) => {
      formData.append('files', blob, `sample_${i}.wav`);
    });

    const response = await fetch(`${this.baseUrl}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData,
    });

    if (!response.ok) throw new Error(`Clone failed: ${response.status}`);
    return response.json() as Promise<{ voice_id: string }>;
  }

  async listVoices(): Promise<ElevenLabsVoice[]> {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey },
    });

    if (!response.ok) throw new Error(`List voices failed: ${response.status}`);
    const data = await response.json() as { voices: ElevenLabsVoice[] };
    return data.voices;
  }

  async getUsage(): Promise<ElevenLabsUsage> {
    const response = await fetch(`${this.baseUrl}/user/subscription`, {
      headers: { 'xi-api-key': this.apiKey },
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
