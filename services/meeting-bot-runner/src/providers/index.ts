export interface ProviderDriver {
  join(meetingUrl: string): Promise<void>;
  waitUntilInCall(): Promise<void>;
  waitUntilEnded(): Promise<void>;
  leave(): Promise<void>;
}