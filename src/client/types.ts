export interface PlayerState {
  id: string;
  emoji: string;
  typing: string;
  color: string;
}

export interface HistoryEntry {
  text: string;
  color: string;
  emoji: string;
}

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
}

export interface StateMessage {
  type: 'state';
  players: PlayerState[];
  hostId: string | null;
  sessionStart: number | null;
}

export interface HistoryMessage {
  type: 'history';
  messages: HistoryEntry[];
}

export interface LaunchMessage {
  type: 'launch';
  text: string;
  id: string;
  color: string;
  emoji: string;
}

export type ServerMessage = WelcomeMessage | StateMessage | HistoryMessage | LaunchMessage;
