export type TextContentPart = { type: "text" | "input_text"; text: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | TextContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolDefinition = {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: unknown;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  user?: string;
};

export type AssistantTurn = {
  rawText: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls";
};
