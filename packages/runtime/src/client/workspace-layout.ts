export const WORKSPACE_MIN_SURFACE_WIDTH = 520;
export const WORKSPACE_MIN_CONVERSATION_WIDTH = 340;
export const WORKSPACE_MAX_CONVERSATION_WIDTH = 440;

export interface WorkspaceLayoutInput {
  frameWidth: number;
  sidebarWidth: number;
}

export interface WorkspaceLayoutColumns {
  conversationWidth: number;
  surfaceWidth: number;
}

/** Resolve a usable business/conversation split or request full-frame fallback. */
export function resolveWorkspaceLayout({
  frameWidth,
  sidebarWidth,
}: WorkspaceLayoutInput): WorkspaceLayoutColumns | null {
  const availableWidth = Math.max(0, frameWidth - sidebarWidth);
  const maxConversationWidth = availableWidth - WORKSPACE_MIN_SURFACE_WIDTH;
  if (maxConversationWidth < WORKSPACE_MIN_CONVERSATION_WIDTH) return null;

  const preferredConversationWidth = Math.round(frameWidth * 0.31);
  const conversationWidth = Math.min(
    WORKSPACE_MAX_CONVERSATION_WIDTH,
    maxConversationWidth,
    Math.max(WORKSPACE_MIN_CONVERSATION_WIDTH, preferredConversationWidth),
  );

  return {
    conversationWidth,
    surfaceWidth: availableWidth - conversationWidth,
  };
}
