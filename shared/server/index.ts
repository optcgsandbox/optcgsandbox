// Barrel exports for the Phase E server-authoritative foundation.
//
// Importers should only ever pull from `shared/server` — never reach into
// individual files. Keeps the public surface stable as internals evolve.

export { MatchSession } from './MatchSession.js';
export type {
  LoggedAction,
  ApplyResult,
  ApplyResultAccepted,
  ApplyResultRejected,
  ValidationResult,
} from './MatchSession.js';

export { computeStateHash, canonicalize, fnv1a64 } from './stateHash.js';

export { projectForViewer } from './publicProjection.js';
export type {
  ViewerId,
  PublicGameState,
  PublicPlayerView,
} from './publicProjection.js';

export {
  serializeReplay,
  deserializeReplay,
  validateReplay,
  replayToFinalState,
  REPLAY_SCHEMA_VERSION,
} from './serialize.js';
export type {
  MatchReplayV1,
  ReplaySchemaVersion,
  ValidationOutcome,
  ValidationOk,
  ValidationFail,
} from './serialize.js';

export {
  serializeCompactReplay,
  deserializeCompactReplay,
  validateCompactReplay,
  compactReplayToFinalState,
  hashCardLibrary,
  REPLAY_SCHEMA_VERSION_V2,
} from './serializeCompact.js';
export type {
  MatchReplayV2,
  InitialStatePatch,
  StaticData,
  StaticDataRef,
  ReplaySchemaVersionV2,
  SerializeCompactOptions,
} from './serializeCompact.js';

export {
  MemoryReplayStore,
  FsReplayStore,
  runReplayStoreContractSuite,
} from './storage/index.js';

export {
  MatchRoom,
  InProcessTransport,
  parseClientMessage,
  WorkerRoomAdapter,
  StaticTokenAuthBinding,
  StrictSeatAssignmentPolicy,
  AuthenticatedInProcessTransport,
  SupabaseJwtAuthBinding,
  verifyJwt,
} from './transport/index.js';
export type {
  IncomingBody,
  ParseResult,
  SocketSink,
  FrameResult,
  AuthenticatedClient,
  AuthenticateResult,
  AuthBinding,
  RoomSeatView,
  SeatAssignmentResult,
  SeatAssignmentPolicy,
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
  SupabaseJwtAuthBindingConfig,
  JwtHeader,
  JwtPayload,
  JwtVerifyConfig,
  JwtVerifyResult,
} from './transport/index.js';
export type {
  ReplayStore,
  ReplayMetadata,
  SaveResult,
  LoadResult,
  DeleteResult,
  ReplayStoreContractOptions,
} from './storage/index.js';
