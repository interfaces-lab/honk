export interface ChatDraftFile {
  type: "path" | "inline";
  path: string;
  name: string;
  kind: "file" | "image";
  mimeType?: string;
  data?: string;
  size?: number;
}

export interface ChatDraftSkill {
  id: string;
  name: string;
  start: number;
  end: number;
}
