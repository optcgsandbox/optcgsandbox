// Barrel exports for shared/server/transport.

export { MatchRoom } from './MatchRoom.js';
export { InProcessTransport } from './InProcessTransport.js';
export type { IncomingBody } from './InProcessTransport.js';

export { parseClientMessage } from './parseClientMessage.js';
export type { ParseResult } from './parseClientMessage.js';

export { WorkerRoomAdapter } from './WorkerRoomAdapter.js';
export type { SocketSink, FrameResult } from './WorkerRoomAdapter.js';

export {
  StaticTokenAuthBinding,
  StrictSeatAssignmentPolicy,
  AuthenticatedInProcessTransport,
} from './auth.js';

export { SupabaseJwtAuthBinding } from './SupabaseJwtAuthBinding.js';
export type { SupabaseJwtAuthBindingConfig } from './SupabaseJwtAuthBinding.js';

export { verifyJwt } from './jwt.js';
export type {
  JwtHeader,
  JwtPayload,
  JwtVerifyConfig,
  JwtVerifyResult,
} from './jwt.js';
export type {
  AuthenticatedClient,
  AuthenticateResult,
  AuthBinding,
  RoomSeatView,
  SeatAssignmentResult,
  SeatAssignmentPolicy,
} from './auth.js';
export type {
  ClientMessage,
  ClientMessageJoin,
  ClientMessageSubmitAction,
  ClientMessageRequestSnapshot,
  ClientMessageLeave,
  ClientMessageType,
  ServerMessage,
  ServerMessageJoined,
  ServerMessageActionAccepted,
  ServerMessageActionRejected,
  ServerMessageSnapshot,
  ServerMessageOpponentJoined,
  ServerMessageOpponentLeft,
  ServerMessageError,
  ServerMessageType,
  MatchRoomDispatch,
} from './protocol.js';
