export type FileMap = Record<string, string>;

export type AgentMode = "agent" | "ask";

export type ProviderId = "openrouter" | "xai" | "deepseek" | "yandex" | "nvidia" | "custom";

export type ToolStatus = "running" | "done" | "error";

export type ToolCallEvent = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: string;
};

export type CrewStep = {
  role: string;
  label: string;
  status: "running" | "done" | "handoff";
  note?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallEvent[];
  crew?: CrewStep[];
};

export type ChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

export type TodoItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type ConnectionSettings = {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ComputerLog = {
  id: string;
  at: number;
  kind: "tool" | "terminal" | "edit" | "system";
  title: string;
  detail?: string;
};

export type InboxItem = {
  id: string;
  fromHost: string;
  prompt: string;
  mode: AgentMode;
  status: "pending" | "accepted" | "rejected" | "done";
  createdAt: number;
  result?: string;
};

export type SentItem = {
  id: string;
  host: string;
  hostname: string;
  prompt: string;
  mode: AgentMode;
  status: "pending" | "accepted" | "rejected" | "done" | "error";
  createdAt: number;
  result?: string;
};

export type PeerPublicStatus = {
  hostname: string;
  listening: boolean;
  pin: string | null;
  port: number;
  addresses: string[];
  inboundPeer: string | null;
  outbound: { hostname: string; host: string } | null;
  inbox: InboxItem[];
  sent: SentItem[];
};
